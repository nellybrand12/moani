import {
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
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSeconds: number;
  private readonly maxAttempts = 5;

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

  /**
   * Generates a 6-digit OTP, hashes it, stores it in Redis with TTL,
   * and sends it to the provided phone number via SMS or WhatsApp.
   *
   * A fresh send always overwrites and un-expires any previous code
   * for this phone — only the newest code is ever valid.
   */
  async send(phone: string, channel: OtpChannel = 'sms'): Promise<void> {
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

    const message = `Your Moani verification code is: ${code}`;

    if (channel === 'whatsapp') {
      try {
        await this.whatsapp.send(phone, message);
      } catch (error) {
        this.logger.warn(
          `WhatsApp delivery to ${phone} failed (${(error as Error)?.message ?? error}). Falling back to SMS.`,
        );
        await this.sms.send(phone, message);
      }
    } else {
      await this.sms.send(phone, message);
    }
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

