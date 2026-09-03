import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma/prisma.service';

/**
 * AdminService — thin wrapper around admin-specific Prisma queries.
 *
 * Verification/review endpoints (approve/reject KYC/KYB) are NOT built
 * here yet — that's the next task.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the AdminProfile for a given userId, or throws 404. */
  async findProfile(userId: string) {
    const profile = await this.prisma.db.adminProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException(
        `Admin profile not found for user ${userId}`,
      );
    }

    return profile;
  }
}
