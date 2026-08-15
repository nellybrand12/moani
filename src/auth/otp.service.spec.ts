import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { SmsService } from '../notifications/sms.service';
import { OtpService } from './otp.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeOtpRow = (
  overrides: Partial<{
    id: string;
    phone: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    consumedAt: Date | null;
  }> = {},
) => ({
  id: 'otp-id-1',
  phone: '+237600000001',
  codeHash: '$2b$10$placeholder',
  expiresAt: new Date(Date.now() + 10 * 60 * 1_000), // 10 min from now
  attempts: 0,
  consumedAt: null,
  ...overrides,
});

const makePrisma = () => ({
  db: {
    phoneOtp: {
      create: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
  },
});

const makeSms = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OtpService', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof makePrisma>;
  let sms: ReturnType<typeof makeSms>;

  beforeEach(async () => {
    prisma = makePrisma();
    sms = makeSms();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: SmsService, useValue: sms },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  // ── send ───────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('stores a hashed code, never the raw code', async () => {
      await service.send('+237600000001');

      const calls = prisma.db.phoneOtp.create.mock.calls as Array<
        [{ data: { codeHash: string; phone: string } }]
      >;
      const createCall = calls[0][0];

      // The stored hash must not be the 6-digit numeric raw code
      expect(createCall.data.codeHash).toMatch(/^\$2[ab]\$/); // bcrypt prefix
      expect(createCall.data.phone).toBe('+237600000001');
    });

    it('sends an SMS after storing the OTP', async () => {
      await service.send('+237600000001');

      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(sms.send).toHaveBeenCalledWith(
        '+237600000001',
        expect.stringContaining('verification code'),
      );
    });
  });

  // ── verify ─────────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('throws when no unconsumed OTP exists', async () => {
      prisma.db.phoneOtp.findFirst.mockResolvedValue(null);

      await expect(service.verify('+237600000001', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when OTP is expired', async () => {
      prisma.db.phoneOtp.findFirst.mockResolvedValue(
        makeOtpRow({ expiresAt: new Date(Date.now() - 1_000) }),
      );

      await expect(service.verify('+237600000001', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when attempts >= 5', async () => {
      prisma.db.phoneOtp.findFirst.mockResolvedValue(
        makeOtpRow({ attempts: 5 }),
      );

      await expect(service.verify('+237600000001', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('increments attempts on code mismatch and throws', async () => {
      const bcrypt = await import('bcrypt');
      const realHash = await bcrypt.hash('654321', 1); // hash a different code

      prisma.db.phoneOtp.findFirst.mockResolvedValue(
        makeOtpRow({ codeHash: realHash }),
      );

      await expect(
        service.verify('+237600000001', '123456'), // wrong code
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.db.phoneOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { attempts: { increment: 1 } },
        }),
      );
    });

    it('marks consumedAt on successful match', async () => {
      const bcrypt = await import('bcrypt');
      const code = '123456';
      const realHash = await bcrypt.hash(code, 1);

      prisma.db.phoneOtp.findFirst.mockResolvedValue(
        makeOtpRow({ codeHash: realHash }),
      );

      await service.verify('+237600000001', code);

      const updateMatcher: Record<string, unknown> = {
        data: expect.objectContaining({
          consumedAt: expect.any(Date) as unknown,
        }),
      };
      expect(prisma.db.phoneOtp.update).toHaveBeenCalledWith(
        expect.objectContaining(updateMatcher),
      );
    });

    it('throws when OTP is already consumed', async () => {
      prisma.db.phoneOtp.findFirst.mockResolvedValue(null); // consumed otps are excluded by query

      await expect(service.verify('+237600000001', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
