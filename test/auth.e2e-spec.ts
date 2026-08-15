import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { Role } from '../generated/prisma/client';
import { AuthModule } from '../src/auth/auth.module';
import { OtpService } from '../src/auth/otp.service';
import { PrismaService } from '../src/lib/database/prisma/prisma.service';
import { UsersModule } from '../src/users/users.module';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PHONE = '+237600000099';
const TEST_PASSWORD = 'Secure1pass';
const TEST_OTP = '123456';
const USER_ID = 'test-uuid-e2e-0001';

const hashedPassword = bcrypt.hashSync(TEST_PASSWORD, 1);

const storedUser = {
  id: USER_ID,
  phone: TEST_PHONE,
  isPhoneVerified: true,
  email: null,
  firstName: 'E2E',
  lastName: 'User',
  passwordHash: hashedPassword,
  dateOfBirth: new Date('1995-06-15'),
  transactionPinHash: bcrypt.hashSync('1234', 1),
  role: Role.USER,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  db: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    phoneOtp: {
      create: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
  },
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
};

const mockOtp = {
  send: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn().mockResolvedValue(undefined),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: 'e2e-test-secret',
              JWT_EXPIRES_IN: '1h',
              OTP_TTL_MINUTES: '10',
            }),
          ],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        PassportModule,
        JwtModule.register({
          secret: 'e2e-test-secret',
          signOptions: { expiresIn: '1h' },
        }),
        AuthModule,
        UsersModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(OtpService)
      .useValue(mockOtp)
      .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    beforeEach(() => {
      mockPrisma.db.user.findUnique.mockResolvedValue(null);
      mockPrisma.db.user.create.mockResolvedValue(storedUser);
      mockOtp.verify.mockResolvedValue(undefined);
    });

    it('returns accessToken and excludes passwordHash + transactionPinHash', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          phone: TEST_PHONE,
          otp: TEST_OTP,
          firstName: 'E2E',
          lastName: 'User',
          password: TEST_PASSWORD,
          dateOfBirth: '1995-06-15',
          transactionPin: '1234',
        })
        .expect(201);

      interface RegisterBody {
        accessToken: string;
        user: {
          id: string;
          passwordHash?: string;
          transactionPinHash?: string;
        };
      }

      const body = res.body as RegisterBody;

      expect(body).toHaveProperty('accessToken');
      expect(typeof body.accessToken).toBe('string');
      expect(body.user).toBeDefined();
      expect(body.user.passwordHash).toBeUndefined();
      expect(body.user.transactionPinHash).toBeUndefined();

      accessToken = body.accessToken;
    });
  });

  // ── GET /users/:id — self access ───────────────────────────────────────────

  describe('GET /users/:id (self)', () => {
    it('returns 200 for the authenticated user accessing their own resource', async () => {
      mockPrisma.db.user.findUnique.mockResolvedValue(storedUser);

      const res = await request(app.getHttpServer())
        .get(`/users/${USER_ID}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      interface UserBody {
        id: string;
        passwordHash?: string;
        transactionPinHash?: string;
      }
      const body = res.body as UserBody;

      expect(body.id).toBe(USER_ID);
      expect(body.passwordHash).toBeUndefined();
      expect(body.transactionPinHash).toBeUndefined();
    });
  });

  // ── GET /users/:id — cross-user access denied ──────────────────────────────

  describe('GET /users/:id (different user)', () => {
    it("returns 403 when a user tries to access another user's resource", async () => {
      mockPrisma.db.user.findUnique.mockResolvedValue(storedUser);

      const OTHER_ID = 'other-user-uuid-9999';

      await request(app.getHttpServer())
        .get(`/users/${OTHER_ID}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });
});
