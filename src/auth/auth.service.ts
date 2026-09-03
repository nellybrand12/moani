import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { TokenBlacklistService } from '../lib/token-blacklist/token-blacklist.service';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { UserEntity } from '../users/entities/user.entity';
import type { AdminRegisterDto } from './dto/admin-register.dto';
import type { LoginDto } from './dto/login.dto';
import type { MerchantRegisterDto } from './dto/merchant-register.dto';
import type { RegisterDto } from './dto/register.dto';
import type { SendOtpDto } from './dto/send-otp.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { OtpService } from './otp.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
    private readonly blacklist: TokenBlacklistService,
  ) {}

  /**
   * Sends an OTP to the given phone number.
   * Throws ConflictException if the phone is already registered.
   */
  async sendOtp(dto: SendOtpDto): Promise<{ message: string }> {
    const existing = await this.prisma.db.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Phone number is already registered');
    }

    await this.otpService.send(dto.phone, dto.channel ?? 'sms');
    return { message: 'OTP sent successfully' };
  }

  /**
   * Registers a new user after OTP verification.
   *
   * Order of operations:
   *  1. Conflict-check (idempotent guard)
   *  2. OTP verify — throws if wrong/expired/consumed
   *  3. Hash password and transactionPin separately
   *  4. Create the user row with isPhoneVerified: true
   *  5. Sign and return a JWT
   *
   * No user row is ever created for an unverified phone.
   */
  async register(
    dto: RegisterDto,
  ): Promise<{ accessToken: string; user: UserEntity }> {
    const existing = await this.prisma.db.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Phone number is already registered');
    }

    // OTP must verify before any DB write — no account if OTP fails
    await this.otpService.verify(dto.phone, dto.otp);

    const [passwordHash, transactionPinHash] = await Promise.all([
      bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      bcrypt.hash(dto.transactionPin, BCRYPT_ROUNDS),
    ]);

    const user = await this.prisma.db.user.create({
      data: {
        phone: dto.phone,
        isPhoneVerified: true,
        email: dto.email ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        dateOfBirth: new Date(dto.dateOfBirth),
        transactionPinHash,
      },
    });

    const accessToken = this.signToken(user.id, user.role);
    return { accessToken, user: new UserEntity(user) };
  }

  /**
   * Registers a new admin after OTP verification.
   *
   * Creates a User with role=ADMIN and an associated AdminProfile.
   * No dateOfBirth or transactionPin required.
   */
  async registerAdmin(
    dto: AdminRegisterDto,
  ): Promise<{ accessToken: string; user: UserEntity }> {
    await this.assertPhoneAvailable(dto.phone);
    await this.assertEmailAvailable(dto.email);

    // OTP must verify before any DB write
    await this.otpService.verify(dto.phone, dto.otp);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.db.user.create({
      data: {
        phone: dto.phone,
        isPhoneVerified: true,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        role: 'ADMIN',
        adminProfile: {
          create: {
            department: dto.department ?? null,
            permissionsLevel: dto.permissionsLevel ?? 1,
          },
        },
      },
    });

    const accessToken = this.signToken(user.id, user.role);
    return { accessToken, user: new UserEntity(user) };
  }

  /**
   * Registers a new merchant owner after OTP verification.
   *
   * Creates a User with role=MERCHANT and an associated MerchantOwnerProfile
   * with kycStatus=PENDING. No transactionPin required.
   */
  async registerMerchant(
    dto: MerchantRegisterDto,
  ): Promise<{ accessToken: string; user: UserEntity }> {
    await this.assertPhoneAvailable(dto.phone);
    if (dto.email) {
      await this.assertEmailAvailable(dto.email);
    }

    // OTP must verify before any DB write
    await this.otpService.verify(dto.phone, dto.otp);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.db.user.create({
      data: {
        phone: dto.phone,
        isPhoneVerified: true,
        email: dto.email ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        dateOfBirth: new Date(dto.dateOfBirth),
        role: 'MERCHANT',
        merchantOwnerProfile: {
          create: {},
        },
      },
    });

    const accessToken = this.signToken(user.id, user.role);
    return { accessToken, user: new UserEntity(user) };
  }

  /**
   * Authenticates via email-or-phone + password.
   *
   * If email is provided, the user must have isEmailVerified=true.
   * Returns the same error for "not found" and "wrong password"
   * to prevent enumeration attacks.
   */
  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; user: UserEntity }> {
    const user = dto.phone
      ? await this.prisma.db.user.findUnique({ where: { phone: dto.phone } })
      : await this.prisma.db.user.findUnique({
          where: { email: dto.email! },
        });

    // Email login requires prior verification
    if (dto.email && user && !user.isEmailVerified) {
      throw new UnauthorizedException(
        'Email not verified. Please verify your email or log in with your phone number.',
      );
    }

    const isMatch =
      user !== null && (await bcrypt.compare(dto.password, user.passwordHash));

    if (!user || !isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.signToken(user.id, user.role);
    return { accessToken, user: new UserEntity(user) };
  }

  /**
   * Revokes the provided JWT so it cannot be used again.
   *
   * Decodes the token to read the `exp` claim and computes the remaining
   * TTL so the blacklist entry is automatically cleaned up when the token
   * would have expired anyway.
   */
  logout(token: string): { message: string } {
    const decoded = this.jwtService.decode<{ exp?: number }>(token);
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = decoded?.exp ?? nowSec;
    const ttlMs = Math.max((expSec - nowSec) * 1000, 0);

    this.blacklist.revoke(token, ttlMs);
    return { message: 'Logged out successfully' };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private signToken(sub: string, role: string): string {
    const payload: JwtPayload = { sub, role: role as JwtPayload['role'] };
    return this.jwtService.sign(payload);
  }

  private async assertPhoneAvailable(phone: string): Promise<void> {
    const existing = await this.prisma.db.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Phone number is already registered');
    }
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
  }
}
