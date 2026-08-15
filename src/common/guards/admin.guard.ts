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
 * AdminGuard — allows only users with Role.ADMIN.
 *
 * Assumes JwtAuthGuard has already run and populated request.user.
 * Apply at the method level, after JwtAuthGuard at the class level.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user: RequestUser }>();
    if (req.user?.role !== Role.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
