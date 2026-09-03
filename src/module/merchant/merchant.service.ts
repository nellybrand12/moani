import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma/prisma.service';
import type { AddBusinessDto } from './dto/add-business.dto';
import type { BusinessType } from '../../../generated/prisma/client';

/**
 * MerchantService — business management for merchant owners.
 *
 * A business cannot be created until the owner's KYC status is VERIFIED.
 * This is enforced as a service-layer check, not just a schema constraint.
 */
@Injectable()
export class MerchantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new business for the authenticated merchant owner.
   *
   * Enforces: MerchantOwnerProfile.kycStatus must be VERIFIED.
   * New businesses default to TIER_1, verificationStatus=PENDING,
   * operationalStatus=ACTIVE.
   */
  async addBusiness(ownerId: string, dto: AddBusinessDto) {
    const profile = await this.prisma.db.merchantOwnerProfile.findUnique({
      where: { userId: ownerId },
      select: { kycStatus: true },
    });

    if (!profile) {
      throw new NotFoundException('Merchant owner profile not found');
    }

    if (profile.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        'Your KYC must be verified before you can add a business. ' +
          `Current status: ${profile.kycStatus}`,
      );
    }

    return this.prisma.db.business.create({
      data: {
        ownerId,
        businessName: dto.businessName,
        businessType: dto.businessType as BusinessType,
        businessEmail: dto.businessEmail ?? null,
        businessPhone: dto.businessPhone ?? null,
        address: dto.address,
        city: dto.city,
      },
    });
  }

  /** Returns all businesses owned by the given user. */
  async findBusinessesByOwner(ownerId: string) {
    return this.prisma.db.business.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns the MerchantOwnerProfile for a given userId, or throws 404. */
  async findProfile(userId: string) {
    const profile = await this.prisma.db.merchantOwnerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException(
        `Merchant owner profile not found for user ${userId}`,
      );
    }

    return profile;
  }
}
