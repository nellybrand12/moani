import type { Role } from '../../../generated/prisma/client';

/**
 * Shape of the data encoded inside every JWT issued by this application.
 *
 * - sub: the user's UUID (standard JWT subject claim)
 * - role: the user's role at the time the token was issued
 *
 * JwtStrategy re-fetches the user on every request so stale roles are
 * corrected on the next token refresh, not immediately.
 */
export interface JwtPayload {
  sub: string;
  role: Role;
}
