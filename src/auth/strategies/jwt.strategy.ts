import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '../../../generated/prisma/client';
import { PrismaService } from '../../lib/database/prisma/prisma.service';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

export interface AuthUser {
  id: string;
  role: Role;
}

/**
 * JwtStrategy — Passport strategy for Bearer token authentication.
 *
 * validate() re-fetches the user from the database on every request so that:
 *   - deleted or deactivated users are rejected even with a valid token
 *   - role changes propagate immediately (no stale cached role)
 *
 * The return value becomes request.user throughout the request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return { id: user.id, role: user.role };
  }
}
