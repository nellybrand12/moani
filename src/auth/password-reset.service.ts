import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { MailService } from '../lib/mail/mail.service';
import { SmsService } from '../notifications/sms.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

export type ResetChannel = 'sms' | 'whatsapp' | 'email';

const BCRYPT_ROUNDS = 10;
// Password reset token TTL: 5 minutes (per spec — shorter than phone OTP)
const RESET_TTL_SECONDS = 300;

/**
 * PasswordResetService — multi-channel password reset flow.
 *
 * request()  — looks up the user, mints a signed JWT, stores it in Redis,
 *              and delivers the link via the chosen channel.
 * confirm()  — verifies the JWT + Redis key, validates the new password,
 *              writes the new hash, and consumes the token.
 *
 * Redis key: pwd-reset:<userId>  (TTL 300 s)
 * Token:     signed JWT { sub: userId } exp 300 s
 */
@Injectable()
export class PasswordResetService {
  private readonly frontendUrl: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
  ) {
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  }

  private key(userId: string): string {
    return `pwd-reset:${userId}`;
  }

  /**
   * Request a password reset link.
   *
   * Looks up the user by phone. If not found, returns the same success
   * response as a real request to prevent phone enumeration (AC-8).
   *
   * Validates that the email channel is only used when isEmailVerified (AC-3).
   */
  async request(
    phone: string,
    channel: ResetChannel,
  ): Promise<{ message: string }> {
    const user = await this.prisma.db.user.findUnique({
      where: { phone },
      select: { id: true, email: true, isEmailVerified: true },
    });

    // Return identical response for missing phones — no enumeration (AC-8).
    if (!user) {
      return {
        message: 'If that number is registered, a reset link is on its way.',
      };
    }

    if (channel === 'email') {
      if (!user.isEmailVerified || !user.email) {
        throw new BadRequestException(
          'Email channel is only available after your email address has been verified.',
        );
      }
    }

    // Mint a short-lived signed JWT (5 min).
    const token = this.jwtService.sign(
      { sub: user.id, type: 'pwd-reset' },
      { expiresIn: RESET_TTL_SECONDS },
    );

    // Overwrite any previous token so only the latest link works.
    await this.redis.set(this.key(user.id), token, 'EX', RESET_TTL_SECONDS);

    const link = `${this.frontendUrl}/reset-password?token=${token}`;
    const text = `Reset your Moani password by clicking this link (expires in 5 minutes):\n${link}`;

    if (channel === 'sms') {
      await this.sms.send(phone, text);
    } else if (channel === 'whatsapp') {
      await this.whatsapp.send(phone, text);
    } else {
      await this.mail.send(
        user.email!,
        'Reset your Moani password',
        text,
        `<p>Reset your Moani password:</p>
         <p><a href="${link}">Click here to reset your password</a></p>
         <p>This link expires in 5 minutes. If you didn't request this, ignore it.</p>`,
      );
    }

    return {
      message: 'If that number is registered, a reset link is on its way.',
    };
  }

  /**
   * Confirm a password reset using the signed JWT from the link.
   *
   * Validates:
   *  1. JWT signature and expiry
   *  2. Redis key still present and matches (not consumed or expired)
   *  3. newPassword === confirmPassword
   *  4. newPassword meets the existing policy (min 8, lower + upper + digit)
   *
   * On success: writes the new hash, deletes the Redis key (AC-6).
   */
  async confirm(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    // 1. Verify JWT signature and expiry.
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify<{ sub: string; type: string }>(token);
    } catch {
      throw new UnauthorizedException('Reset link is invalid or has expired.');
    }

    if (payload.type !== 'pwd-reset') {
      throw new UnauthorizedException('Invalid reset token.');
    }

    const userId = payload.sub;

    // 2. Verify the token is still live in Redis (not consumed or overtaken by a newer request).
    const stored = await this.redis.get(this.key(userId));
    if (!stored || stored !== token) {
      throw new UnauthorizedException(
        'Reset link has already been used or expired. Request a new one.',
      );
    }

    // 3. Passwords must match.
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    // 4. Password policy: min 8 chars, at least one lowercase, one uppercase, one digit.
    const policyPattern = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
    if (newPassword.length < 8 || !policyPattern.test(newPassword)) {
      throw new BadRequestException(
        'Password must be at least 8 characters and contain at least one lowercase letter, one uppercase letter, and one digit.',
      );
    }

    // Consume the token before writing the new password (fail-safe: even if
    // the update throws, the token is gone so it cannot be replayed).
    await this.redis.del(this.key(userId));

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return {
      message:
        'Password updated successfully. You can now log in with your new password.',
    };
  }
}
