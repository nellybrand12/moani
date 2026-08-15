import { Injectable } from '@nestjs/common';

/**
 * TokenBlacklistService — in-memory set of revoked JWT strings.
 *
 * A token is added on logout and rejected by JwtAuthGuard thereafter.
 * This is a process-scoped store; tokens survive only for the lifetime
 * of the server process. Acceptable for a single-instance dev/staging
 * setup. Swap for Redis when running multiple replicas.
 *
 * Tokens are auto-purged after their own expiry to prevent unbounded growth.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly blacklist = new Map<string, NodeJS.Timeout>();

  /**
   * Adds the raw JWT to the blacklist and schedules its removal after
   * `ttlMs` milliseconds (should match the token's remaining TTL).
   */
  revoke(token: string, ttlMs: number): void {
    if (this.blacklist.has(token)) return;

    const timer = setTimeout(() => {
      this.blacklist.delete(token);
    }, ttlMs);

    // Allow Node to exit even if the timer is still pending
    timer.unref();

    this.blacklist.set(token, timer);
  }

  /** Returns true if the token has been revoked. */
  isRevoked(token: string): boolean {
    return this.blacklist.has(token);
  }
}
