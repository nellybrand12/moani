import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { MailService } from '../lib/mail/mail.service';
import { SmsService } from '../notifications/sms.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { PasswordResetService } from './password-reset.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeRedis = () => ({
  get: jest.fn<Promise<string | null>, [string]>(),
  set: jest.fn<Promise<'OK'>, unknown[]>().mockResolvedValue('OK' as const),
  del: jest.fn<Promise<number>, [string]>().mockResolvedValue(1),
});

const makePrisma = () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  },
});

const makeJwt = () => ({
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
});

const makeMail = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeSms = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeWhatsapp = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeConfig = () => ({
  get: jest.fn().mockReturnValue('http://localhost:3000'),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let redis: ReturnType<typeof makeRedis>;
  let prisma: ReturnType<typeof makePrisma>;
  let jwt: ReturnType<typeof makeJwt>;
  let mail: ReturnType<typeof makeMail>;
  let sms: ReturnType<typeof makeSms>;
  let whatsapp: ReturnType<typeof makeWhatsapp>;

  beforeEach(async () => {
    redis = makeRedis();
    prisma = makePrisma();
    jwt = makeJwt();
    mail = makeMail();
    sms = makeSms();
    whatsapp = makeWhatsapp();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: mail },
        { provide: SmsService, useValue: sms },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    service = module.get(PasswordResetService);
  });

  // ── request ────────────────────────────────────────────────────────────────

  describe('request', () => {
    const registeredPhone = '+237600000001';
    const verifiedUser = {
      id: 'uuid-1',
      email: 'user@example.com',
      isEmailVerified: true,
    };

    it('returns generic success message when user is not found (anti-enumeration)', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      const result = await service.request('+237699999999');

      expect(result).toEqual({
        message: 'If that number is registered, a reset link is on its way.',
      });
      expect(mail.send).not.toHaveBeenCalled();
      expect(sms.send).not.toHaveBeenCalled();
      expect(whatsapp.send).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has no verified email address and email channel is requested', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        email: 'user@example.com',
        isEmailVerified: false,
      });

      await expect(service.request(registeredPhone, 'email')).rejects.toThrow(
        BadRequestException,
      );
      expect(mail.send).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has no email address configured and email channel is requested', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        email: null,
        isEmailVerified: false,
      });

      await expect(service.request(registeredPhone, 'email')).rejects.toThrow(
        BadRequestException,
      );
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('delivers reset link via email when email channel is selected and email is verified', async () => {
      prisma.db.user.findUnique.mockResolvedValue(verifiedUser);

      const result = await service.request(registeredPhone, 'email');

      expect(result).toEqual({
        message: 'If that number is registered, a reset link is on its way.',
      });

      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: verifiedUser.id, type: 'pwd-reset' },
        { expiresIn: 300 },
      );

      expect(redis.set).toHaveBeenCalledWith(
        'pwd-reset:uuid-1',
        'mock.jwt.token',
        'EX',
        300,
      );

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledWith(
        'user@example.com',
        'Reset your Moani password',
        expect.stringContaining(
          'http://localhost:3000/reset-password?token=mock.jwt.token',
        ),
        expect.stringContaining(
          'http://localhost:3000/reset-password?token=mock.jwt.token',
        ),
      );
      expect(sms.send).not.toHaveBeenCalled();
      expect(whatsapp.send).not.toHaveBeenCalled();
    });

    it('delivers reset link via SMS by default to user phone number', async () => {
      prisma.db.user.findUnique.mockResolvedValue(verifiedUser);

      const result = await service.request(registeredPhone);

      expect(result).toEqual({
        message: 'If that number is registered, a reset link is on its way.',
      });

      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(sms.send).toHaveBeenCalledWith(
        registeredPhone,
        expect.stringContaining(
          'http://localhost:3000/reset-password?token=mock.jwt.token',
        ),
      );
      expect(whatsapp.send).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('delivers reset link via WhatsApp to user phone number when whatsapp channel is selected', async () => {
      prisma.db.user.findUnique.mockResolvedValue(verifiedUser);

      const result = await service.request(registeredPhone, 'whatsapp');

      expect(result).toEqual({
        message: 'If that number is registered, a reset link is on its way.',
      });

      expect(whatsapp.send).toHaveBeenCalledTimes(1);
      expect(whatsapp.send).toHaveBeenCalledWith(
        registeredPhone,
        expect.stringContaining(
          'http://localhost:3000/reset-password?token=mock.jwt.token',
        ),
      );
      expect(sms.send).not.toHaveBeenCalled();
    });

    it('falls back to SMS when WhatsApp delivery fails for reset link', async () => {
      prisma.db.user.findUnique.mockResolvedValue(verifiedUser);
      whatsapp.send.mockRejectedValueOnce(
        new Error('WhatsApp delivery failed'),
      );

      const result = await service.request(registeredPhone, 'whatsapp');

      expect(result).toEqual({
        message: 'If that number is registered, a reset link is on its way.',
      });

      expect(whatsapp.send).toHaveBeenCalledTimes(1);
      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(sms.send).toHaveBeenCalledWith(
        registeredPhone,
        expect.stringContaining(
          'http://localhost:3000/reset-password?token=mock.jwt.token',
        ),
      );
    });
  });

  // ── confirm ────────────────────────────────────────────────────────────────

  describe('confirm', () => {
    const validToken = 'valid.jwt.token';
    const userId = 'uuid-1';

    beforeEach(() => {
      jwt.verify.mockReturnValue({ sub: userId, type: 'pwd-reset' });
      redis.get.mockResolvedValue(validToken);
    });

    it('throws UnauthorizedException if JWT verification fails', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(
        service.confirm('invalid.token', 'NewPass123', 'NewPass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if JWT token type is wrong', async () => {
      jwt.verify.mockReturnValue({ sub: userId, type: 'auth' });

      await expect(
        service.confirm(validToken, 'NewPass123', 'NewPass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if Redis token is missing or does not match (replayed / expired)', async () => {
      redis.get.mockResolvedValue(null);

      await expect(
        service.confirm(validToken, 'NewPass123', 'NewPass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when newPassword and confirmPassword do not match', async () => {
      await expect(
        service.confirm(validToken, 'NewPass123', 'MismatchPass456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when newPassword does not satisfy policy', async () => {
      // Missing uppercase
      await expect(
        service.confirm(validToken, 'lowercase123', 'lowercase123'),
      ).rejects.toThrow(BadRequestException);

      // Missing digit
      await expect(
        service.confirm(validToken, 'NoDigitsHere', 'NoDigitsHere'),
      ).rejects.toThrow(BadRequestException);

      // Too short (< 8 chars)
      await expect(service.confirm(validToken, 'Sh1', 'Sh1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates password and consumes token in Redis on success', async () => {
      const result = await service.confirm(
        validToken,
        'SecureNewPass1',
        'SecureNewPass1',
      );

      expect(result).toEqual({
        message:
          'Password updated successfully. You can now log in with your new password.',
      });

      expect(redis.del).toHaveBeenCalledWith(`pwd-reset:${userId}`);
      expect(prisma.db.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { passwordHash: expect.stringMatching(/^\$2[ab]\$/) },
      });
    });
  });
});
