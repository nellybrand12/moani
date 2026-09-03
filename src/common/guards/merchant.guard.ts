import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';

interface RequestUser {
  id: string;
  role: Role;
}

/**
 * MerchantGuard — allows only users with Role.MERCHANT.
 *
 * Assumes JwtAuthGuard has already run and populated request.user.
 * Apply at the method or controller level, after JwtAuthGuard.
 */
@Injectable()
export class MerchantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user: RequestUser }>();
    if (req.user?.role !== Role.MERCHANT) {
      throw new ForbiddenException('Merchant access required');
    }
    return true;
  }
}
