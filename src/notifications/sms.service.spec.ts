/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { SmsService, isAfricasTalkingConfigured } from './sms.service';
import { WhatsappService } from './whatsapp.service';

describe('isAfricasTalkingConfigured', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false when AT_API_KEY is not set', () => {
    delete process.env['AT_API_KEY'];
    process.env['AT_USERNAME'] = 'sandbox';
    expect(isAfricasTalkingConfigured()).toBe(false);
  });

  it('returns false when AT_USERNAME is not set', () => {
    process.env['AT_API_KEY'] = '1234567890abcdef1234567890abcdef';
    delete process.env['AT_USERNAME'];
    expect(isAfricasTalkingConfigured()).toBe(false);
  });

  it('returns false for placeholder "not-set-yet"', () => {
    process.env['AT_API_KEY'] = 'not-set-yet';
    process.env['AT_USERNAME'] = 'not-set-yet';
    expect(isAfricasTalkingConfigured()).toBe(false);
  });

  it('returns false for placeholder "dev"', () => {
    process.env['AT_API_KEY'] = 'dev';
    process.env['AT_USERNAME'] = 'sandbox';
    expect(isAfricasTalkingConfigured()).toBe(false);
  });

  it('returns false when AT_API_KEY is dummy "sandbox"', () => {
    process.env['AT_API_KEY'] = 'sandbox';
    process.env['AT_USERNAME'] = 'sandbox';
    expect(isAfricasTalkingConfigured()).toBe(false);
  });

  it('returns false for dummy masks like "xxxx"', () => {
    process.env['AT_API_KEY'] = 'xxxxxxxxxxxxxxxx';
    process.env['AT_USERNAME'] = 'myuser';
    expect(isAfricasTalkingConfigured()).toBe(false);
  });

  it('returns true when valid credentials are provided', () => {
    process.env['AT_API_KEY'] =
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    process.env['AT_USERNAME'] = 'sandbox';
    expect(isAfricasTalkingConfigured()).toBe(true);
  });
});

describe('SmsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when unconfigured (stub mode)', () => {
    let service: SmsService;
    let whatsapp: Partial<WhatsappService>;

    beforeEach(async () => {
      process.env['AT_API_KEY'] = 'not-set-yet';
      process.env['AT_USERNAME'] = 'not-set-yet';

      whatsapp = {
        send: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SmsService,
          { provide: WhatsappService, useValue: whatsapp },
        ],
      }).compile();

      service = module.get(SmsService);
    });

    it('sendOtp logs stub and succeeds without throwing for login flow', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      await expect(
        service.sendOtp({
          phone: '+237600000001',
          code: '123456',
          flow: 'login',
        }),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[OTP STUB - LOGIN]'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    });

    it('sendOtp logs stub and succeeds without throwing for password-reset flow', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      await expect(
        service.sendOtp({
          phone: '+237600000001',
          code: '654321',
          flow: 'password-reset',
          expiresInMinutes: 10,
        }),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[OTP STUB - PASSWORD-RESET]'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('password reset code is: 654321'),
      );
    });

    it('send logs stub and succeeds without throwing', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      await expect(
        service.send('+237600000001', 'Test message'),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SMS STUB]'),
      );
    });
  });

  describe('when configured', () => {
    let service: SmsService;
    let whatsapp: Partial<WhatsappService>;
    let mockSmsClient: { send: jest.Mock };

    beforeEach(async () => {
      process.env['AT_API_KEY'] = 'valid-production-api-key-1234567890';
      process.env['AT_USERNAME'] = 'moani-prod';
      process.env['AT_SENDER_ID'] = 'Moani';

      whatsapp = {
        send: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SmsService,
          { provide: WhatsappService, useValue: whatsapp },
        ],
      }).compile();

      service = module.get(SmsService);

      mockSmsClient = {
        send: jest
          .fn()
          .mockResolvedValue({ SMSMessageData: { Recipients: [] } }),
      };
      (service as any).sms = mockSmsClient;
      (service as any).isConfigured = true;
    });

    it('sends via SMS and includes senderId', async () => {
      await service.sendOtp({
        phone: '+237600000001',
        code: '123456',
        flow: 'login',
        channel: 'sms',
      });

      expect(mockSmsClient.send).toHaveBeenCalledTimes(1);
      expect(mockSmsClient.send).toHaveBeenCalledWith({
        to: ['+237600000001'],
        message: 'Your Moani verification code is: 123456',
        from: 'Moani',
      });
    });

    it('sends via WhatsApp when channel is whatsapp', async () => {
      await service.sendOtp({
        phone: '+237600000001',
        code: '123456',
        flow: 'login',
        channel: 'whatsapp',
      });

      expect(whatsapp.send).toHaveBeenCalledTimes(1);
      expect(mockSmsClient.send).not.toHaveBeenCalled();
    });

    it('falls back to SMS when WhatsApp delivery throws', async () => {
      (whatsapp.send as jest.Mock).mockRejectedValueOnce(
        new Error('WhatsApp service unavailable'),
      );

      await service.sendOtp({
        phone: '+237600000001',
        code: '123456',
        flow: 'login',
        channel: 'whatsapp',
      });

      expect(whatsapp.send).toHaveBeenCalledTimes(1);
      expect(mockSmsClient.send).toHaveBeenCalledTimes(1);
    });

    it('catches AT SMS 401 / failure, logs error and warning, and falls back to console without throwing', async () => {
      mockSmsClient.send.mockRejectedValueOnce(
        new Error('Request failed with status code 401'),
      );

      const errorSpy = jest.spyOn((service as any).logger, 'error');
      const warnSpy = jest.spyOn((service as any).logger, 'warn');

      await expect(
        service.sendOtp({
          phone: '+237600000001',
          code: '999888',
          flow: 'password-reset',
          channel: 'sms',
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[OTP FAILED - PASSWORD-RESET]'),
        expect.any(String),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[OTP FALLBACK - PASSWORD-RESET]'),
      );
    });

    it('send method catches AT failure, logs warning, and does not throw', async () => {
      mockSmsClient.send.mockRejectedValueOnce(new Error('Network timeout'));

      const errorSpy = jest.spyOn((service as any).logger, 'error');
      const warnSpy = jest.spyOn((service as any).logger, 'warn');

      await expect(
        service.send('+237600000001', 'Password changed notification'),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Africa's Talking SMS delivery failed"),
        expect.any(String),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SMS FALLBACK]'),
      );
    });
  });
});
