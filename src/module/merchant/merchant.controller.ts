import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantGuard } from '../../common/guards/merchant.guard';
import type { AuthUser } from '../../auth/strategies/jwt.strategy';
import { MerchantService } from './merchant.service';
import { AddBusinessDto } from './dto/add-business.dto';

@Controller('merchants')
@UseGuards(JwtAuthGuard, MerchantGuard)
export class MerchantController {
  constructor(private readonly merchantService: MerchantService) {}

  /**
   * POST /merchants/businesses
   *
   * Adds a new business for the authenticated merchant owner.
   * Requires KYC to be VERIFIED — returns 403 otherwise.
   */
  @Post('businesses')
  addBusiness(@CurrentUser() user: AuthUser, @Body() dto: AddBusinessDto) {
    return this.merchantService.addBusiness(user.id, dto);
  }

  /**
   * GET /merchants/businesses
   *
   * Lists all businesses owned by the authenticated merchant.
   */
  @Get('businesses')
  findMyBusinesses(@CurrentUser() user: AuthUser) {
    return this.merchantService.findBusinessesByOwner(user.id);
  }

  /**
   * GET /merchants/profile
   *
   * Returns the merchant owner's KYC profile (status, document info).
   */
  @Get('profile')
  findMyProfile(@CurrentUser() user: AuthUser) {
    return this.merchantService.findProfile(user.id);
  }
}
