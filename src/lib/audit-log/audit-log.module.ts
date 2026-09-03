import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * AuditLogModule — global module providing AuditLogService.
 *
 * Imported once in AppModule. Infrastructure or feature modules can inject
 * AuditLogService without re-importing this module.
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
