import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { SmsService } from '../notifications/sms.service';

/** Maximum OTP verification attempts before the code is locked */
const MAX_ATTEMPTS = 5;

/**
 * OtpService — manages OTP generation, storage (hashed), and verification.
 *
 * Raw codes are never stored. Only bcrypt hashes are persisted.
 * TTL comes from OTP_TTL_MINUTES env var (default 10 minutes).
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  /**
   * Generates a 6-digit OTP, hashes it, stores it in phone_otps,
   * and sends it to the provided phone number.
   */
  async send(phone: string): Promise<void> {
    const ttlMinutes = parseInt(process.env['OTP_TTL_MINUTES'] ?? '10', 10);
    const code = crypto.randomInt(100_000, 1_000_000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1_000);

    await this.prisma.db.phoneOtp.create({
      data: { phone, codeHash, expiresAt },
    });

    await this.sms.send(phone, `Your Moani verification code is: ${code}`);
  }

  /**
   * Verifies a submitted OTP code for a given phone number.
   *
   * Throws UnauthorizedException if:
   *  - no unconsumed OTP exists for the phone
   *  - the OTP has expired
   *  - attempts >= MAX_ATTEMPTS
   *  - the code does not match the stored hash
   *
   * On success, marks the OTP as consumed (consumedAt = now).
   */
  async verify(phone: string, code: string): Promise<void> {
    const otp = await this.prisma.db.phoneOtp.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new UnauthorizedException('No pending OTP for this phone number');
    }

    if (otp.expiresAt < new Date()) {
      throw new UnauthorizedException('OTP has expired');
    }

    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many failed attempts — request a new code',
      );
    }

    const isMatch = await bcrypt.compare(code, otp.codeHash);

    if (!isMatch) {
      await this.prisma.db.phoneOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    // Mark consumed so the same code cannot be reused
    await this.prisma.db.phoneOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }
}
