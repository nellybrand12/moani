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

interface RequestParams {
  id?: string;
}

/**
 * UserAccessGuard — allows ADMIN unconditionally, or a user accessing
 * their own resource (request.user.id === request.params.id).
 *
 * Assumes JwtAuthGuard has already run and populated request.user.
 * Apply at the method level on any :id-scoped route.
 */
@Injectable()
export class UserAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user: RequestUser; params: RequestParams }>();

    const user = req.user;
    const paramId = req.params?.id;

    if (user?.role === Role.ADMIN || user?.id === paramId) {
      return true;
    }

    throw new ForbiddenException('Access denied');
  }
}
