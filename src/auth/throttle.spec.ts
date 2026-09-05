/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { ThrottlerExceptionFilter } from '../common/filters/throttler-exception.filter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailOtpService } from './email-otp.service';
import { PasswordResetService } from './password-reset.service';
import { UsersService } from '../users/users.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockAuthService = {
  sendOtp: jest.fn().mockResolvedValue({ message: 'OTP sent successfully' }),
  register: jest.fn(),
  registerAdmin: jest.fn(),
  registerMerchant: jest.fn(),
  login: jest.fn().mockResolvedValue({
    accessToken: 'mock.jwt',
    user: { id: 'u1' },
  }),
  logout: jest.fn(),
};

const mockUsersService = {
  findOne: jest.fn(),
  updateEmailVerified: jest.fn(),
};

const mockEmailOtp = {
  assertHasEmail: jest.fn(),
  send: jest.fn(),
  verify: jest.fn(),
};

const mockPasswordReset = {
  initiate: jest.fn().mockResolvedValue({ resetSessionId: 'mock.session.jwt' }),
  chooseMethod: jest
    .fn()
    .mockResolvedValue({ message: "If eligible, we've sent a code/link." }),
  verifyOtp: jest.fn(),
  verifyEmailToken: jest.fn(),
  complete: jest.fn(),
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Rate Limiting (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        // Use short TTL (60 s) and low limits for test speed.
        // OTP send: 3 per 15 min → we override to 3 per 60 s in the controller
        // via @Throttle, but here we use a global default + override.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
      ],
      controllers: [AuthController, AppController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: EmailOtpService, useValue: mockEmailOtp },
        { provide: PasswordResetService, useValue: mockPasswordReset },
        AppService,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new ThrottlerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── OTP send rate limiting ─────────────────────────────────────────────────

  describe('POST /auth/otp/send', () => {
    it('allows requests up to the throttle limit (not 429)', async () => {
      // The controller sets @Throttle({ default: { limit: 3, ttl: 900_000 } })
      // In the test, all requests come from the same IP (127.0.0.1).
      // ValidationPipe may reject the body (400) but that's fine —
      // the key assertion is that the throttler does NOT reject (429).
      for (let i = 0; i < 3; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/otp/send')
          .send({ phone: '+237600000001' });

        // Should NOT be 429 — throttler hasn't kicked in yet
        expect(res.status).not.toBe(429);
      }
    });

    it('returns 429 after exceeding the throttle limit', async () => {
      // Exhaust the limit (3 requests)
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/otp/send')
          .send({ phone: '+237600000001' });
      }

      // 4th request should be throttled
      const res = await request(app.getHttpServer())
        .post('/auth/otp/send')
        .send({ phone: '+237600000001' });

      expect(res.status).toBe(429);
      expect(res.body.statusCode).toBe(429);
      expect(res.body.message).toContain('Too many requests');
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  // ── Health check bypass ────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('is never throttled even after many requests', async () => {
      // Send well beyond the global limit
      for (let i = 0; i < 110; i++) {
        const res = await request(app.getHttpServer()).get('/health');
        expect(res.status).toBe(200);
      }
    });
  });

  // ── Login rate limiting ────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns 429 after exceeding the login throttle limit', async () => {
      // Login limit is 5 per 15 min per IP
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ phone: '+237600000001', password: 'Test1234' });
      }

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ phone: '+237600000001', password: 'Test1234' });

      expect(res.status).toBe(429);
      expect(res.body.retryAfter).toBeDefined();
    });
  });

  // ── 429 response shape ─────────────────────────────────────────────────────

  describe('429 response format', () => {
    it('includes Retry-After header and structured body', async () => {
      // Exhaust OTP send limit
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/otp/send')
          .send({ phone: '+237600000002' });
      }

      const res = await request(app.getHttpServer())
        .post('/auth/otp/send')
        .send({ phone: '+237600000002' });

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
      expect(res.body).toEqual({
        statusCode: 429,
        message: 'Too many requests. Please try again later.',
        retryAfter: 60,
      });
    });
  });
});
