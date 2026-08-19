import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '../../generated/prisma/client';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { TokenBlacklistService } from '../lib/token-blacklist/token-blacklist.service';
import { UserEntity } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'uuid-1',
  phone: '+237600000001',
  isPhoneVerified: true,
  email: null,
  firstName: 'Jane',
  lastName: 'Doe',
  profilePicture: null,
  passwordHash: '$2b$10$hashed',
  dateOfBirth: new Date('1995-01-01'),
  transactionPinHash: '$2b$10$pinHashed',
  role: Role.USER,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makePrisma = () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
});

const makeOtp = () => ({
  send: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn().mockResolvedValue(undefined),
});

const makeJwt = () => ({
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  decode: jest
    .fn()
    .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
});

const makeBlacklist = () => ({
  revoke: jest.fn(),
  isRevoked: jest.fn().mockReturnValue(false),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof makePrisma>;
  let otp: ReturnType<typeof makeOtp>;
  let jwt: ReturnType<typeof makeJwt>;
  let blacklist: ReturnType<typeof makeBlacklist>;

  beforeEach(async () => {
    prisma = makePrisma();
    otp = makeOtp();
    jwt = makeJwt();
    blacklist = makeBlacklist();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpService, useValue: otp },
        { provide: JwtService, useValue: jwt },
        { provide: TokenBlacklistService, useValue: blacklist },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── sendOtp ────────────────────────────────────────────────────────────────

  describe('sendOtp', () => {
    it('sends OTP with default channel when no channel provided', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      const result = await service.sendOtp({ phone: '+237600000001' });

      expect(result).toEqual({ message: 'OTP sent successfully' });
      expect(otp.send).toHaveBeenCalledWith('+237600000001', 'sms');
    });

    it('sends OTP via whatsapp channel when specified', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      const result = await service.sendOtp({
        phone: '+237600000001',
        channel: 'whatsapp',
      });

      expect(result).toEqual({ message: 'OTP sent successfully' });
      expect(otp.send).toHaveBeenCalledWith('+237600000001', 'whatsapp');
    });

    it('throws ConflictException when phone is already registered', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.sendOtp({ phone: '+237600000001' })).rejects.toThrow(
        ConflictException,
      );
      expect(otp.send).not.toHaveBeenCalled();
    });
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe('register', () => {
    const dto = {
      phone: '+237600000001',
      otp: '123456',
      firstName: 'Jane',
      lastName: 'Doe',
      email: undefined,
      password: 'Secure1pass',
      dateOfBirth: '1995-01-01',
      transactionPin: '1234',
    };

    it('returns { accessToken, user } on success', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);
      prisma.db.user.create.mockResolvedValue(mockUser);

      const result = await service.register(dto);

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toBeInstanceOf(UserEntity);
    });

    it('throws ConflictException when phone is already registered', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('throws when OTP verification fails', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);
      otp.verify.mockRejectedValue(new UnauthorizedException('Invalid OTP'));

      await expect(service.register(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      // User create must NOT have been called
      expect(prisma.db.user.create).not.toHaveBeenCalled();
    });

    it('hashes password and transactionPin before persisting', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);
      prisma.db.user.create.mockResolvedValue(mockUser);

      await service.register(dto);

      const calls = prisma.db.user.create.mock.calls as Array<
        [{ data: { passwordHash: string; transactionPinHash: string } }]
      >;
      const createCall = calls[0][0];
      // Hashes must not equal the raw values
      expect(createCall.data.passwordHash).not.toBe(dto.password);
      expect(createCall.data.transactionPinHash).not.toBe(dto.transactionPin);
      // Hashes must look like bcrypt output
      expect(createCall.data.passwordHash).toMatch(/^\$2[ab]\$/);
      expect(createCall.data.transactionPinHash).toMatch(/^\$2[ab]\$/);
    });
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    // Use a real bcrypt hash of 'Secure1pass' with 10 rounds so compare works
    // We mock bcrypt indirectly by using the actual bcrypt in the service,
    // but seed the user with a hash that matches the test password.
    const password = 'Secure1pass';

    it('throws UnauthorizedException for unknown phone', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ phone: '+237600000001', password }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password with the same message', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: '$2b$10$badHashThatWillNotMatch',
      });

      let unknownPhoneError: UnauthorizedException | undefined;
      let wrongPasswordError: UnauthorizedException | undefined;

      prisma.db.user.findUnique.mockResolvedValueOnce(null);
      try {
        await service.login({ phone: '+237600000001', password });
      } catch (e) {
        unknownPhoneError = e as UnauthorizedException;
      }

      prisma.db.user.findUnique.mockResolvedValueOnce({
        ...mockUser,
        passwordHash: '$2b$10$badHash',
      });
      try {
        await service.login({ phone: '+237600000001', password });
      } catch (e) {
        wrongPasswordError = e as UnauthorizedException;
      }

      expect(unknownPhoneError?.message).toBe(wrongPasswordError?.message);
    });

    it('returns { accessToken, user } on correct credentials', async () => {
      // Hash the password the same way the service would
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash(password, 1); // 1 round for speed in tests

      prisma.db.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
      });

      const result = await service.login({ phone: '+237600000001', password });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toBeInstanceOf(UserEntity);
    });
  });
});
