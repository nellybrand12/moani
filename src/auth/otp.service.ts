import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SmsService } from '../notifications/sms.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import type { OtpChannel } from './dto/send-otp.dto';

interface OtpRecord {
  codeHash: string;
  attempts: number;
}

/**
 * OtpService — manages OTP generation, storage (hashed), and verification.
 *
 * Raw codes are never stored. Only bcrypt hashes are persisted.
 * Storage is Redis (Upstash, TLS) with native TTL — no Postgres I/O.
 * TTL comes from OTP_TTL_MINUTES env var (default 10 minutes).
 *
 * Delivery is supported via WhatsApp and SMS to the user's phone number.
 *
 * Rate limiting (two independent layers):
 *  1. Per-IP:    @Throttle on the controller (3 req / 15 min)
 *  2. Per-phone: 90-second cooldown enforced here via a separate Redis key.
 *                Returns 409 (not 429) with `retryAfterSeconds` so the
 *                mobile app can render an accurate countdown timer.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSeconds: number;
  private readonly maxAttempts = 5;

  /**
   * Minimum interval between OTP sends for the same phone number.
   * Independent of the per-IP throttler — both apply simultaneously.
   */
  private readonly cooldownSeconds = 90;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sms: SmsService,
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = Number(this.config.get('OTP_TTL_MINUTES') ?? 10) * 60;
  }

  private key(phone: string): string {
    return `otp:${phone}`;
  }

  /** Redis key for the per-phone resend cooldown (separate from the OTP key). */
  private cooldownKey(phone: string): string {
    return `otp-cooldown:${phone}`;
  }

  /**
   * Generates a 6-digit OTP, hashes it, stores it in Redis with TTL,
   * and sends it to the provided phone number via SMS or WhatsApp.
   *
   * A fresh send always overwrites and un-expires any previous code
   * for this phone — only the newest code is ever valid.
   *
   * Enforces a 90-second per-phone cooldown. If the cooldown is active,
   * throws ConflictException (409) with the remaining seconds so the
   * mobile app can show "Resend in 0:47".
   */
  async send(phone: string, channel: OtpChannel = 'sms'): Promise<void> {
    // ── Per-phone cooldown (90 s) ───────────────────────────────────────
    // This is independent of the per-IP throttler. A user can hit this
    // even if they haven't exhausted their 3-per-15-min IP allowance.
    const remainingCooldown = await this.redis.ttl(this.cooldownKey(phone));
    if (remainingCooldown > 0) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Please wait before requesting another code.',
        retryAfterSeconds: remainingCooldown,
      });
    }

    const code = randomInt(100_000, 1_000_000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const record: OtpRecord = { codeHash, attempts: 0 };

    // SET + EX stores the record and sets its expiry atomically.
    await this.redis.set(
      this.key(phone),
      JSON.stringify(record),
      'EX',
      this.ttlSeconds,
    );

    await this.sms.sendOtp({
      phone,
      code,
      flow: 'login',
      channel,
      expiresInMinutes: this.ttlSeconds / 60,
    });

    // Set cooldown AFTER successful send — a failed send (e.g. SMS
    // provider down) should not lock the user out.
    await this.redis.set(
      this.cooldownKey(phone),
      '1',
      'EX',
      this.cooldownSeconds,
    );
  }

  /**
   * Verifies a submitted OTP code for a given phone number.
   *
   * Throws UnauthorizedException if:
   *  - no OTP key exists (never sent, expired, or already consumed)
   *  - attempts >= maxAttempts
   *  - the code does not match the stored hash
   *
   * On success, deletes the key so the code can never be replayed.
   */
  async verify(phone: string, code: string): Promise<void> {
    const raw = await this.redis.get(this.key(phone));

    if (!raw) {
      // Covers "never sent", "expired" (Redis already deleted it), and
      // "already consumed" (verify() deletes on success) in one check.
      throw new UnauthorizedException(
        'OTP expired or not found, request a new one',
      );
    }

    const record: OtpRecord = JSON.parse(raw) as OtpRecord;

    if (record.attempts >= this.maxAttempts) {
      await this.redis.del(this.key(phone));
      throw new UnauthorizedException(
        'Too many failed attempts — request a new code',
      );
    }

    const isMatch = await bcrypt.compare(code, record.codeHash);

    if (!isMatch) {
      record.attempts += 1;
      // KEEPTTL: update the attempts count without resetting the
      // expiry clock — a bad guess shouldn't buy the attacker more time.
      await this.redis.set(this.key(phone), JSON.stringify(record), 'KEEPTTL');
      throw new UnauthorizedException('Invalid OTP');
    }

    // Consume immediately so this code can never be replayed.
    await this.redis.del(this.key(phone));
  }
}
