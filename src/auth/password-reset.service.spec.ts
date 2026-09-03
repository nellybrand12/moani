/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { MailService } from '../lib/mail/mail.service';
import { SmsService } from '../notifications/sms.service';
import { TokenBlacklistService } from '../lib/token-blacklist/token-blacklist.service';
import { PasswordResetService } from './password-reset.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_TTL_S = 600; // 10 min in seconds

/** A realistic session row (live, OTP path configured). */
const baseSession = {
  id: 'session-uuid-1',
  userId: 'user-uuid-1',
  method: 'OTP' as const,
  otpHash: null as string | null,
  emailTokenHash: null as string | null,
  expiresAt: new Date(Date.now() + SESSION_TTL_S * 1000),
  usedAt: null as Date | null,
  attempts: 0,
  createdAt: new Date(),
};

const makePrisma = () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    passwordResetSession: {
      create: jest.fn().mockResolvedValue({ id: baseSession.id }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  },
});

const makeJwt = () => ({
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
  decode: jest
    .fn()
    .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 300 }),
});

const makeMail = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeSms = () => ({
  send: jest.fn().mockResolvedValue(undefined),
  sendOtp: jest.fn().mockResolvedValue(undefined),
});

const makeBlacklist = () => ({
  revoke: jest.fn(),
  isRevoked: jest.fn().mockReturnValue(false),
});

const makeConfig = () => ({
  get: jest.fn((key: string) => {
    if (key === 'FRONTEND_URL') return 'http://localhost:3000';
    if (key === 'PASSWORD_RESET_SESSION_TTL_MINUTES') return '10';
    if (key === 'PASSWORD_RESET_TOKEN_TTL_SECONDS') return '300';
    return undefined;
  }),
  getOrThrow: jest.fn().mockReturnValue('secret'),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let prisma: ReturnType<typeof makePrisma>;
  let jwt: ReturnType<typeof makeJwt>;
  let mail: ReturnType<typeof makeMail>;
  let sms: ReturnType<typeof makeSms>;
  let blacklist: ReturnType<typeof makeBlacklist>;

  beforeEach(async () => {
    prisma = makePrisma();
    jwt = makeJwt();
    mail = makeMail();
    sms = makeSms();
    blacklist = makeBlacklist();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: mail },
        { provide: SmsService, useValue: sms },
        { provide: TokenBlacklistService, useValue: blacklist },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    service = module.get(PasswordResetService);
  });

  // ── initiate ────────────────────────────────────────────────────────────────

  describe('initiate', () => {
    it('returns { resetSessionId } and does NOT create a session row for an unknown phone (ghost session / anti-enumeration)', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      const result = await service.initiate('+237699999999');

      expect(result).toHaveProperty('resetSessionId');
      expect(typeof result.resetSessionId).toBe('string');
      // No DB write for an unknown phone — ghost session only in the JWT.
      expect(prisma.db.passwordResetSession.create).not.toHaveBeenCalled();
    });

    it('returns { resetSessionId } and creates a session row for a real account', async () => {
      prisma.db.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });

      const result = await service.initiate('+237600000001');

      expect(result).toHaveProperty('resetSessionId');
      expect(prisma.db.passwordResetSession.create).toHaveBeenCalledTimes(1);
      const createArg = prisma.db.passwordResetSession.create.mock
        .calls[0][0] as {
        data: { userId: string; expiresAt: Date };
      };
      expect(createArg.data.userId).toBe('user-uuid-1');
      expect(createArg.data.expiresAt).toBeInstanceOf(Date);
    });

    it('signs the JWT with sub: null for ghost sessions', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      await service.initiate('+237699999999');

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: null, type: 'pwd-reset-session' }),
        expect.any(Object),
      );
    });

    it('signs the JWT with the real session id for known accounts', async () => {
      prisma.db.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
      prisma.db.passwordResetSession.create.mockResolvedValue({
        id: 'session-uuid-1',
      });

      await service.initiate('+237600000001');

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'session-uuid-1',
          type: 'pwd-reset-session',
        }),
        expect.any(Object),
      );
    });
  });

  // ── chooseMethod ────────────────────────────────────────────────────────────

  describe('chooseMethod', () => {
    const validSessionJwt = 'valid.session.jwt';

    beforeEach(() => {
      // Default: valid session JWT pointing at a real session row
      jwt.verify.mockReturnValue({
        sub: 'session-uuid-1',
        type: 'pwd-reset-session',
      });
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
      });
    });

    it('throws UnauthorizedException for an expired / invalid session JWT', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.chooseMethod('bad.jwt', 'OTP')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('silently returns success for a ghost session (sub: null) without sending anything', async () => {
      jwt.verify.mockReturnValue({ sub: null, type: 'pwd-reset-session' });

      const result = await service.chooseMethod(validSessionJwt, 'OTP');

      expect(result.message).toMatch(/eligible/i);
      expect(sms.sendOtp).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('OTP path: sends SMS and stores bcrypt-hashed OTP in the session row', async () => {
      prisma.db.user.findUnique.mockResolvedValue({ phone: '+237600000001' });

      await service.chooseMethod(validSessionJwt, 'OTP');

      expect(sms.sendOtp).toHaveBeenCalledTimes(1);
      expect(sms.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+237600000001',
          flow: 'password-reset',
          channel: 'sms',
        }),
      );

      const updateArg = prisma.db.passwordResetSession.update.mock
        .calls[0][0] as {
        data: { method: string; otpHash: string };
      };
      expect(updateArg.data.method).toBe('OTP');
      // Must be a bcrypt hash, never the raw code
      expect(updateArg.data.otpHash).toMatch(/^\$2[ab]\$/);
    });

    it('EMAIL_LINK path: sends email and stores bcrypt-hashed token when account has a verified email', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        email: 'user@example.com',
        isEmailVerified: true,
      });

      const result = await service.chooseMethod(validSessionJwt, 'EMAIL_LINK');

      expect(result.message).toMatch(/eligible/i);
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledWith(
        'user@example.com',
        expect.stringContaining('Reset'),
        expect.stringContaining('reset-password'),
        expect.stringContaining('reset-password'),
      );

      const updateArg = prisma.db.passwordResetSession.update.mock
        .calls[0][0] as {
        data: { method: string; emailTokenHash: string };
      };
      expect(updateArg.data.method).toBe('EMAIL_LINK');
      expect(updateArg.data.emailTokenHash).toMatch(/^\$2[ab]\$/);
    });

    it('EMAIL_LINK path: silently no-ops (no email sent) when account has no email', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        email: null,
        isEmailVerified: false,
      });

      const result = await service.chooseMethod(validSessionJwt, 'EMAIL_LINK');

      expect(result.message).toMatch(/eligible/i);
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.db.passwordResetSession.update).not.toHaveBeenCalled();
    });

    it('EMAIL_LINK path: silently no-ops (no email sent) when email is unverified', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        email: 'user@example.com',
        isEmailVerified: false,
      });

      const result = await service.chooseMethod(validSessionJwt, 'EMAIL_LINK');

      expect(result.message).toMatch(/eligible/i);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for an already-used session', async () => {
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        usedAt: new Date(),
      });

      await expect(
        service.chooseMethod(validSessionJwt, 'OTP'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for an expired session (expiresAt in the past)', async () => {
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.chooseMethod(validSessionJwt, 'OTP'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── verifyOtp ───────────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    const validSessionJwt = 'valid.session.jwt';

    beforeEach(() => {
      jwt.verify.mockReturnValue({
        sub: 'session-uuid-1',
        type: 'pwd-reset-session',
      });
    });

    it('throws UnauthorizedException for an invalid / expired session JWT', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.verifyOtp('bad.jwt', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a ghost session (sub: null)', async () => {
      jwt.verify.mockReturnValue({ sub: null, type: 'pwd-reset-session' });

      await expect(
        service.verifyOtp(validSessionJwt, '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for an expired session (expiresAt in the past)', async () => {
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'OTP',
        otpHash: '$2b$10$placeholder',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyOtp(validSessionJwt, '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws on wrong OTP and increments the attempts counter (without consuming session)', async () => {
      const bcrypt = await import('bcrypt');
      const realHash = await bcrypt.hash('654321', 1); // hash a different code
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'OTP',
        otpHash: realHash,
        attempts: 0,
      });

      await expect(
        service.verifyOtp(validSessionJwt, '123456'),
      ).rejects.toThrow(UnauthorizedException);

      // Attempts incremented, session NOT consumed yet
      const updateCall = prisma.db.passwordResetSession.update.mock.calls.find(
        (c) =>
          (c[0] as { data: { attempts?: number } }).data.attempts !== undefined,
      );
      expect(updateCall).toBeDefined();
      expect(
        (updateCall![0] as { data: { attempts: number } }).data.attempts,
      ).toBe(1);

      // usedAt must NOT be set on a simple wrong guess
      const consumeCall = prisma.db.passwordResetSession.update.mock.calls.find(
        (c) => (c[0] as { data: { usedAt?: Date } }).data.usedAt !== undefined,
      );
      expect(consumeCall).toBeUndefined();
    });

    it('locks the session (sets usedAt) and throws on the 5th failed attempt', async () => {
      const bcrypt = await import('bcrypt');
      const realHash = await bcrypt.hash('654321', 1);
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'OTP',
        otpHash: realHash,
        attempts: 4, // 5th attempt will push it to lockout
      });

      await expect(
        service.verifyOtp(validSessionJwt, '123456'),
      ).rejects.toThrow(UnauthorizedException);

      // Session must be consumed (usedAt set)
      const consumeCall = prisma.db.passwordResetSession.update.mock.calls.find(
        (c) => (c[0] as { data: { usedAt?: Date } }).data.usedAt !== undefined,
      );
      expect(consumeCall).toBeDefined();
      expect(
        (consumeCall![0] as { data: { usedAt: Date } }).data.usedAt,
      ).toBeInstanceOf(Date);
    });

    it('throws immediately when attempts are already at MAX (>= 5) before checking code', async () => {
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'OTP',
        otpHash: '$2b$10$placeholder',
        attempts: 5,
      });

      await expect(
        service.verifyOtp(validSessionJwt, '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('succeeds with correct OTP, consumes session, and returns a resetToken', async () => {
      const bcrypt = await import('bcrypt');
      const code = '123456';
      const realHash = await bcrypt.hash(code, 1);
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'OTP',
        otpHash: realHash,
        attempts: 0,
      });

      const result = await service.verifyOtp(validSessionJwt, code);

      expect(result).toHaveProperty('resetToken');
      expect(typeof result.resetToken).toBe('string');

      // Session must have been consumed
      const consumeCall = prisma.db.passwordResetSession.update.mock.calls.find(
        (c) => (c[0] as { data: { usedAt?: Date } }).data.usedAt !== undefined,
      );
      expect(consumeCall).toBeDefined();

      // resetToken must be signed with correct payload
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'session-uuid-1',
          type: 'pwd-reset-token',
        }),
        expect.any(Object),
      );
    });
  });

  // ── verifyEmailToken ────────────────────────────────────────────────────────

  describe('verifyEmailToken', () => {
    it('succeeds for a valid email token and returns a resetToken', async () => {
      const bcrypt = await import('bcrypt');
      const rawToken = 'a'.repeat(128); // 64-byte hex
      const tokenHash = await bcrypt.hash(rawToken, 1);

      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'EMAIL_LINK',
        emailTokenHash: tokenHash,
      });

      const result = await service.verifyEmailToken('session-uuid-1', rawToken);

      expect(result).toHaveProperty('resetToken');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'session-uuid-1',
          type: 'pwd-reset-token',
        }),
        expect.any(Object),
      );
    });

    it('throws UnauthorizedException for an expired session (expiresAt in the past)', async () => {
      const bcrypt = await import('bcrypt');
      const rawToken = 'b'.repeat(128);
      const tokenHash = await bcrypt.hash(rawToken, 1);

      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'EMAIL_LINK',
        emailTokenHash: tokenHash,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyEmailToken('session-uuid-1', rawToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for an already-used session', async () => {
      const bcrypt = await import('bcrypt');
      const rawToken = 'c'.repeat(128);
      const tokenHash = await bcrypt.hash(rawToken, 1);

      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'EMAIL_LINK',
        emailTokenHash: tokenHash,
        usedAt: new Date(),
      });

      await expect(
        service.verifyEmailToken('session-uuid-1', rawToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a wrong email token', async () => {
      const bcrypt = await import('bcrypt');
      const realToken = 'd'.repeat(128);
      const tokenHash = await bcrypt.hash(realToken, 1);

      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        method: 'EMAIL_LINK',
        emailTokenHash: tokenHash,
      });

      await expect(
        service.verifyEmailToken('session-uuid-1', 'wrong-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── complete ────────────────────────────────────────────────────────────────

  describe('complete', () => {
    beforeEach(() => {
      // Default: valid resetToken JWT pointing at a consumed session
      jwt.verify.mockReturnValue({
        sub: 'session-uuid-1',
        type: 'pwd-reset-token',
      });
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        usedAt: new Date(), // must be consumed (set by verifyOtp/verifyEmailToken)
      });
      prisma.db.user.findUnique.mockResolvedValue({
        phone: '+237600000001',
        email: 'user@example.com',
        isEmailVerified: true,
        firstName: 'Jane',
      });
    });

    it('throws UnauthorizedException for an invalid / expired resetToken', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.complete('bad.token', 'NewPass123', 'NewPass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if resetToken type is wrong', async () => {
      jwt.verify.mockReturnValue({ sub: 'session-uuid-1', type: 'auth' });

      await expect(
        service.complete('wrong.type.token', 'NewPass123', 'NewPass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when session row is not consumed (usedAt is null)', async () => {
      // Session not yet consumed — token must have been forged or reused
      prisma.db.passwordResetSession.findUnique.mockResolvedValue({
        ...baseSession,
        usedAt: null, // not consumed
      });

      await expect(
        service.complete('mock.jwt.token', 'NewPass123', 'NewPass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when passwords do not match', async () => {
      await expect(
        service.complete('mock.jwt.token', 'NewPass123', 'DifferentPass456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when password is shorter than 8 characters', async () => {
      await expect(
        service.complete('mock.jwt.token', 'Sh1', 'Sh1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when password has no uppercase letter', async () => {
      await expect(
        service.complete('mock.jwt.token', 'nouppercase1', 'nouppercase1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when password has no digit', async () => {
      await expect(
        service.complete('mock.jwt.token', 'NoDigitsHere', 'NoDigitsHere'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the password hash with a bcrypt hash on success', async () => {
      await service.complete(
        'mock.jwt.token',
        'SecureNewPass1',
        'SecureNewPass1',
      );

      expect(prisma.db.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { passwordHash: expect.stringMatching(/^\$2[ab]\$/) },
      });
    });

    it('revokes the resetToken via TokenBlacklistService on success', async () => {
      await service.complete(
        'mock.jwt.token',
        'SecureNewPass1',
        'SecureNewPass1',
      );

      expect(blacklist.revoke).toHaveBeenCalledTimes(1);
      expect(blacklist.revoke).toHaveBeenCalledWith(
        'mock.jwt.token',
        expect.any(Number),
      );
    });

    it('sends SMS and email notifications on success', async () => {
      await service.complete(
        'mock.jwt.token',
        'SecureNewPass1',
        'SecureNewPass1',
      );

      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(sms.send).toHaveBeenCalledWith(
        '+237600000001',
        expect.stringContaining('password was just changed'),
      );
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledWith(
        'user@example.com',
        expect.stringContaining('changed'),
        expect.stringContaining('password was just changed'),
        expect.any(String),
      );
    });

    it('sends only SMS notification when user has no verified email', async () => {
      prisma.db.user.findUnique.mockResolvedValue({
        phone: '+237600000001',
        email: null,
        isEmailVerified: false,
        firstName: 'Jane',
      });

      await service.complete(
        'mock.jwt.token',
        'SecureNewPass1',
        'SecureNewPass1',
      );

      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('returns a success message on completion', async () => {
      const result = await service.complete(
        'mock.jwt.token',
        'SecureNewPass1',
        'SecureNewPass1',
      );

      expect(result).toEqual({
        message:
          'Password updated successfully. You can now log in with your new password.',
      });
    });
  });
});
