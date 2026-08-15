import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '../../../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PrismaService — wraps PrismaClient for NestJS lifecycle management.
 *
 * Prisma v7 note: PrismaClient is an interface, not a class, so we use
 * composition instead of inheritance. The `db` property exposes the full
 * type-safe client for injection into feature services.
 *
 * Usage in feature services:
 *   constructor(private readonly prisma: PrismaService) {}
 *   await this.prisma.db.user.findMany()
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * The Prisma v7 client instance. Use this in feature services to run queries.
   * PrismaPg manages the pg.Pool internally — pass options directly to the adapter.
   */
  readonly db: PrismaClient;

  constructor() {
    this.db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        // Supabase session pooler supports up to 200 connections per project.
        // Keep max well below that to leave headroom across multiple app instances.
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.db.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
    this.logger.log('Database connection closed');
  }
}
