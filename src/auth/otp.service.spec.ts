import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SmsService } from '../notifications/sms.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { OtpService } from './otp.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Redis mock with just the methods OtpService uses. */
const makeRedis = () => ({
  get: jest.fn<Promise<string | null>, [string]>(),
  set: jest.fn<Promise<'OK'>, unknown[]>().mockResolvedValue('OK' as const),
  del: jest.fn<Promise<number>, [string]>().mockResolvedValue(1),
});

const makeSms = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeConfig = (otpTtl = '10') => ({
  get: jest.fn().mockReturnValue(otpTtl),
  getOrThrow: jest.fn().mockReturnValue(otpTtl),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OtpService', () => {
  let service: OtpService;
  let redis: ReturnType<typeof makeRedis>;
  let sms: ReturnType<typeof makeSms>;

  beforeEach(async () => {
    redis = makeRedis();
    sms = makeSms();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: SmsService, useValue: sms },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  // ── send ───────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('stores a hashed code (bcrypt), never the raw code', async () => {
      await service.send('+237600000001');

      const [_key, value] = redis.set.mock.calls[0] as [
        string,
        string,
        ...unknown[],
      ];
      const record = JSON.parse(value) as {
        codeHash: string;
        attempts: number;
      };

      expect(record.codeHash).toMatch(/^\$2[ab]\$/); // bcrypt prefix
      expect(record.attempts).toBe(0);
    });

    it('stores the record with an EX expiry', async () => {
      await service.send('+237600000001');

      const args = redis.set.mock.calls[0];
      expect(args).toContain('EX');
      // 10 min × 60 s = 600 s
      expect(args).toContain(600);
    });

    it('keys the record by phone number', async () => {
      await service.send('+237600000001');

      const key = redis.set.mock.calls[0]?.[0] as string;
      expect(key).toBe('otp:+237600000001');
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
    it('throws when the key does not exist (expired / never sent / already consumed)', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.verify('+237600000001', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws and deletes the key when attempts >= maxAttempts', async () => {
      const record = { codeHash: '$2b$10$placeholder', attempts: 5 };
      redis.get.mockResolvedValue(JSON.stringify(record));

      await expect(service.verify('+237600000001', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(redis.del).toHaveBeenCalledWith('otp:+237600000001');
    });

    it('throws, increments attempts with KEEPTTL, and leaves the key on wrong code', async () => {
      const bcrypt = await import('bcrypt');
      const realHash = await bcrypt.hash('654321', 1); // hash a different code
      const record = { codeHash: realHash, attempts: 0 };
      redis.get.mockResolvedValue(JSON.stringify(record));

      await expect(
        service.verify('+237600000001', '123456'), // wrong code
      ).rejects.toThrow(UnauthorizedException);

      // Should have called set (not del) to keep the key alive
      const setArgs = redis.set.mock.calls[0];
      expect(setArgs).toContain('KEEPTTL');

      const updated = JSON.parse(setArgs[1] as string) as {
        attempts: number;
        codeHash: string;
      };
      expect(updated.attempts).toBe(1);

      // Key must NOT be deleted on a wrong guess
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('deletes the key (consumes the OTP) on correct code', async () => {
      const bcrypt = await import('bcrypt');
      const code = '123456';
      const realHash = await bcrypt.hash(code, 1);
      const record = { codeHash: realHash, attempts: 0 };
      redis.get.mockResolvedValue(JSON.stringify(record));

      await service.verify('+237600000001', code);

      expect(redis.del).toHaveBeenCalledWith('otp:+237600000001');
    });

    it('does not call set or del on success (just del)', async () => {
      const bcrypt = await import('bcrypt');
      const code = '123456';
      const realHash = await bcrypt.hash(code, 1);
      const record = { codeHash: realHash, attempts: 0 };
      redis.get.mockResolvedValue(JSON.stringify(record));

      await service.verify('+237600000001', code);

      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});
