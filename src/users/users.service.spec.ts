import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Role } from '../../generated/prisma/client';
import { EmailOtpService } from '../auth/email-otp.service';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'uuid-1',
  phone: '+237600000001',
  isPhoneVerified: true,
  isEmailVerified: true,
  email: 'user@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  profilePicture:
    'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png',
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
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
});

const makeEmailOtp = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof makePrisma>;
  let emailOtp: ReturnType<typeof makeEmailOtp>;

  beforeEach(async () => {
    prisma = makePrisma();
    emailOtp = makeEmailOtp();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailOtpService, useValue: emailOtp },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findAll', () => {
    it('returns all users as UserEntity instances', async () => {
      prisma.db.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(UserEntity);
      expect(result[0].id).toBe(mockUser.id);
    });
  });

  describe('findOne', () => {
    it('returns user as UserEntity when found', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOne('uuid-1');

      expect(result).toBeInstanceOf(UserEntity);
      expect(result.id).toBe('uuid-1');
    });

    it('throws NotFoundException when user is not found', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('uuid-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when user is not found', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('uuid-unknown', { firstName: 'NewName' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates firstName, lastName, and profilePicture without touching email or PIN', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);
      prisma.db.user.update.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated',
        lastName: 'Name',
        profilePicture: 'https://example.com/new-pic.png',
      });

      const result = await service.update('uuid-1', {
        firstName: 'Updated',
        lastName: 'Name',
        profilePicture: 'https://example.com/new-pic.png',
      });

      expect(result.firstName).toBe('Updated');
      expect(result.lastName).toBe('Name');
      expect(result.profilePicture).toBe('https://example.com/new-pic.png');
      expect(emailOtp.send).not.toHaveBeenCalled();
      expect(prisma.db.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          firstName: 'Updated',
          lastName: 'Name',
          profilePicture: 'https://example.com/new-pic.png',
        },
      });
    });

    it('resets isEmailVerified to false and sends OTP when email changes', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);
      prisma.db.user.update.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        isEmailVerified: false,
      });

      const result = await service.update('uuid-1', {
        email: 'new@example.com',
      });

      expect(result.email).toBe('new@example.com');
      expect(result.isEmailVerified).toBe(false);
      expect(emailOtp.send).toHaveBeenCalledTimes(1);
      expect(emailOtp.send).toHaveBeenCalledWith('uuid-1', 'new@example.com');
      expect(prisma.db.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          email: 'new@example.com',
          isEmailVerified: false,
        },
      });
    });

    it('does not reset isEmailVerified or send OTP when email is unchanged', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);
      prisma.db.user.update.mockResolvedValue(mockUser);

      await service.update('uuid-1', {
        email: 'user@example.com',
      });

      expect(emailOtp.send).not.toHaveBeenCalled();
    });

    describe('transactionPin update', () => {
      it('throws BadRequestException when transactionPin is provided without password', async () => {
        prisma.db.user.findUnique.mockResolvedValue(mockUser);

        await expect(
          service.update('uuid-1', { transactionPin: '5678' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws UnauthorizedException when account password is incorrect', async () => {
        const hash = await bcrypt.hash('CorrectPassword1', 1);
        prisma.db.user.findUnique.mockResolvedValue({
          ...mockUser,
          passwordHash: hash,
        });

        await expect(
          service.update('uuid-1', {
            transactionPin: '5678',
            password: 'WrongPassword1',
          }),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('updates transactionPinHash when correct account password is provided', async () => {
        const hash = await bcrypt.hash('CorrectPassword1', 1);
        prisma.db.user.findUnique.mockResolvedValue({
          ...mockUser,
          passwordHash: hash,
        });
        prisma.db.user.update.mockResolvedValue({
          ...mockUser,
          transactionPinHash: '$2b$10$newPinHash',
        });

        const result = await service.update('uuid-1', {
          transactionPin: '5678',
          password: 'CorrectPassword1',
        });

        expect(result).toBeInstanceOf(UserEntity);
        expect(prisma.db.user.update).toHaveBeenCalledWith({
          where: { id: 'uuid-1' },
          data: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            transactionPinHash: expect.stringMatching(/^\$2[ab]\$/),
          },
        });
      });
    });
  });

  describe('updateEmailVerified', () => {
    it('updates isEmailVerified column', async () => {
      prisma.db.user.update.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });

      await service.updateEmailVerified('uuid-1', true);

      expect(prisma.db.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { isEmailVerified: true },
      });
    });
  });

  describe('remove', () => {
    it('deletes and returns the user as UserEntity', async () => {
      prisma.db.user.findUnique.mockResolvedValue(mockUser);
      prisma.db.user.delete.mockResolvedValue(mockUser);

      const result = await service.remove('uuid-1');

      expect(result).toBeInstanceOf(UserEntity);
      expect(prisma.db.user.delete).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('throws NotFoundException if user to remove is not found', async () => {
      prisma.db.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('uuid-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
