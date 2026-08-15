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
import type { LoginDto } from './dto/login.dto';
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

    await this.otpService.send(dto.phone);
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
   * Authenticates via phone + password.
   *
   * Returns the same error for "phone not found" and "wrong password"
   * to prevent phone enumeration attacks.
   */
  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; user: UserEntity }> {
    const user = await this.prisma.db.user.findUnique({
      where: { phone: dto.phone },
    });

    const isMatch =
      user !== null && (await bcrypt.compare(dto.password, user.passwordHash));

    if (!user || !isMatch) {
      throw new UnauthorizedException('Invalid phone number or password');
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

  private signToken(sub: string, role: string): string {
    const payload: JwtPayload = { sub, role: role as JwtPayload['role'] };
    return this.jwtService.sign(payload);
  }
}
