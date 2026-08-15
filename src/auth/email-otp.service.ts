import {
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { MailService } from '../lib/mail/mail.service';

interface OtpRecord {
  codeHash: string;
  attempts: number;
}

/**
 * EmailOtpService — manages OTP verification for email addresses.
 *
 * Same design as OtpService (phone OTP) but keyed by userId, not phone,
 * so a user can only have one live email OTP at a time regardless of address.
 *
 * Redis key:  email-otp:<userId>
 * TTL:        OTP_TTL_MINUTES env var (default 10 min) — shared with phone OTP
 */
@Injectable()
export class EmailOtpService {
  private readonly ttlSeconds: number;
  private readonly maxAttempts = 5;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = Number(this.config.get('OTP_TTL_MINUTES') ?? 10) * 60;
  }

  private key(userId: string): string {
    return `email-otp:${userId}`;
  }

  /**
   * Generate a 6-digit OTP, hash it, store it in Redis under email-otp:<userId>,
   * and email the code to the given address.
   *
   * A new send always overwrites any existing code for this user.
   */
  async send(userId: string, email: string): Promise<void> {
    const code = randomInt(100_000, 1_000_000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const record: OtpRecord = { codeHash, attempts: 0 };

    await this.redis.set(
      this.key(userId),
      JSON.stringify(record),
      'EX',
      this.ttlSeconds,
    );

    await this.mail.send(
      email,
      'Verify your Moani email address',
      `Your Moani email verification code is: ${code}\n\nThis code expires in ${this.ttlSeconds / 60} minutes.`,
      `<p>Your Moani email verification code is: <strong>${code}</strong></p>
       <p>This code expires in ${this.ttlSeconds / 60} minutes.</p>`,
    );
  }

  /**
   * Verify the submitted OTP for a given userId.
   *
   * Throws UnauthorizedException if:
   *  - no key exists (never sent, expired, or already consumed)
   *  - attempts >= maxAttempts
   *  - the code does not match
   *
   * On success, deletes the key so the code can never be replayed.
   */
  async verify(userId: string, code: string): Promise<void> {
    const raw = await this.redis.get(this.key(userId));

    if (!raw) {
      throw new UnauthorizedException(
        'OTP expired or not found, request a new one',
      );
    }

    const record: OtpRecord = JSON.parse(raw) as OtpRecord;

    if (record.attempts >= this.maxAttempts) {
      await this.redis.del(this.key(userId));
      throw new UnauthorizedException(
        'Too many failed attempts — request a new code',
      );
    }

    const isMatch = await bcrypt.compare(code, record.codeHash);

    if (!isMatch) {
      record.attempts += 1;
      await this.redis.set(this.key(userId), JSON.stringify(record), 'KEEPTTL');
      throw new UnauthorizedException('Invalid OTP');
    }

    // Consume immediately so this code can never be replayed.
    await this.redis.del(this.key(userId));
  }

  /**
   * Throws BadRequestException if the user has no email set on their record.
   * Used by the verify endpoint to give a clearer error than a 401.
   */
  assertHasEmail(email: string | null | undefined): void {
    if (!email) {
      throw new BadRequestException(
        'No email address on this account. Add one via PATCH /users/:id first.',
      );
    }
  }
}
