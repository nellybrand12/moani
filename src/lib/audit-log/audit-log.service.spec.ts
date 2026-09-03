import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

const makePrisma = () => ({
  db: {
    auditLog: {
      create: jest.fn(),
    },
  },
});

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AuditLogService);
  });

  it('creates an audit log entry with provided fields', async () => {
    const expectedRecord = {
      id: 'audit-log-uuid-1',
      actorUserId: 'admin-uuid-1',
      action: 'MERCHANT_APPROVED',
      targetType: 'Merchant',
      targetId: 'merchant-uuid-1',
      metadata: { reason: 'KYC verified' },
      createdAt: new Date(),
    };

    prisma.db.auditLog.create.mockResolvedValue(expectedRecord);

    const result = await service.log(
      'admin-uuid-1',
      'MERCHANT_APPROVED',
      'Merchant',
      'merchant-uuid-1',
      { reason: 'KYC verified' },
    );

    expect(prisma.db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.db.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-uuid-1',
        action: 'MERCHANT_APPROVED',
        targetType: 'Merchant',
        targetId: 'merchant-uuid-1',
        metadata: { reason: 'KYC verified' },
      },
    });
    expect(result).toEqual(expectedRecord);
  });

  it('handles optional metadata gracefully when omitted', async () => {
    prisma.db.auditLog.create.mockResolvedValue({
      id: 'audit-log-uuid-2',
      actorUserId: 'admin-uuid-1',
      action: 'USER_SUSPENDED',
      targetType: 'User',
      targetId: 'user-uuid-2',
      metadata: null,
      createdAt: new Date(),
    });

    await service.log('admin-uuid-1', 'USER_SUSPENDED', 'User', 'user-uuid-2');

    expect(prisma.db.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-uuid-1',
        action: 'USER_SUSPENDED',
        targetType: 'User',
        targetId: 'user-uuid-2',
        metadata: undefined,
      },
    });
  });
});
