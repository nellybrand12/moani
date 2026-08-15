import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../lib/token-blacklist/token-blacklist.service';

/**
 * JwtAuthGuard — wraps Passport's 'jwt' strategy and additionally
 * rejects tokens that have been revoked via logout.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly blacklist: TokenBlacklistService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (token && this.blacklist.isRevoked(token)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return super.canActivate(context);
  }
}
