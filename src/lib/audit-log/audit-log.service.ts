import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';

/**
 * AuditLogService — standardized logging for administrative actions.
 *
 * This is the single entry point for persisting audit logs in the system,
 * ensuring consistency of audit trails across modules and controllers.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an audit log record for an administrative action.
   *
   * @param actorUserId - UUID of the admin who initiated the action
   * @param action - Action descriptor (e.g. "MERCHANT_APPROVED", "USER_SUSPENDED")
   * @param targetType - Type of the entity being acted upon (e.g. "User", "Merchant")
   * @param targetId - Identifier of the entity being acted upon
   * @param metadata - Optional JSON details specific to the event
   */
  async log(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Prisma.InputJsonValue | Record<string, unknown>,
  ) {
    this.logger.log(
      `[AUDIT] Actor: ${actorUserId} | Action: ${action} | Target: ${targetType}:${targetId}`,
    );

    return this.prisma.db.auditLog.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
