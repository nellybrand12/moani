import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './lib/database/prisma/prisma.module';
import { MailModule } from './lib/mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './redis/redis.module';
import { TokenBlacklistModule } from './lib/token-blacklist/token-blacklist.module';
import { AuditLogModule } from './lib/audit-log/audit-log.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './module/admin/admin.module';
import { MerchantModule } from './module/merchant/merchant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        // Global baseline: 100 requests per minute per IP.
        // Enough for normal usage; individual routes override with stricter limits.
        //
        // ⚠️  SCALING NOTE: ThrottlerModule uses in-memory storage by default.
        //     This works for a single Railway instance. If the app scales to
        //     multiple replicas, switch to @nestjs/throttler's Redis storage
        //     (e.g. ThrottlerStorageRedisService with Upstash) so limits sync
        //     across instances.
        ttl: 60_000,
        limit: 100,
      },
    ]),
    RedisModule,
    TokenBlacklistModule,
    AuditLogModule,
    MailModule,
    NotificationsModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    AdminModule,
    MerchantModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply ThrottlerGuard globally — every route inherits the baseline limit
    // unless overridden with @Throttle() or excluded with @SkipThrottle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
