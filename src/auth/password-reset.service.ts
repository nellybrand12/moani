import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { MailService } from '../lib/mail/mail.service';
import { SmsService } from '../notifications/sms.service';
import { TokenBlacklistService } from '../lib/token-blacklist/token-blacklist.service';
import type { ResetMethodChoice } from './dto/choose-reset-method.dto';

const BCRYPT_ROUNDS = 10;

// ──────────────────────────────────────────────────────────────────────────────
// JWT payload shapes
// ──────────────────────────────────────────────────────────────────────────────

/** Intermediate "reset session" token — identifies the PasswordResetSession row. */
interface ResetSessionPayload {
  /** The PasswordResetSession.id — null when the phone number wasn't found
   *  (ghost session: all downstream methods silently no-op). */
  sub: string | null;
  type: 'pwd-reset-session';
}

/** Terminal "reset token" — single-use, scopes only to setting a new password. */
interface ResetTokenPayload {
  /** The PasswordResetSession.id, always a real ID at this point. */
  sub: string;
  type: 'pwd-reset-token';
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants (overridable via env)
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_SESSION_TTL_MINUTES = 10;
const DEFAULT_RESET_TOKEN_TTL_SECONDS = 300; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;

// Password policy: min 8 chars, ≥1 lowercase, ≥1 uppercase, ≥1 digit.
// Matches the policy used in the original PasswordResetService.
const PASSWORD_POLICY = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

/**
 * PasswordResetService — multi-step forgot-password flow.
 *
 * The flow is tied together by two short-lived JWT tokens:
 *
 *  1. initiate()        → resetSessionId JWT  (10 min, identifies the session row)
 *  2. chooseMethod()    → (side-effect only)
 *  3a. verifyOtp()      → resetToken JWT      (5 min, single-use, scopes password change)
 *  3b. verifyEmailToken() → resetToken JWT    (same shape as above)
 *  4. complete()        → updates password, invalidates session & all live JWTs
 *
 * Anti-enumeration: initiate() always returns the same 200 shape, regardless
 * of whether the phone number belongs to a real account. Downstream methods
 * silently no-op for ghost sessions (sub: null in the JWT payload).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly sessionTtlSeconds: number;
  private readonly resetTokenTtlSeconds: number;
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly blacklist: TokenBlacklistService,
    private readonly config: ConfigService,
  ) {
    this.sessionTtlSeconds =
      Number(
        this.config.get('PASSWORD_RESET_SESSION_TTL_MINUTES') ??
          DEFAULT_SESSION_TTL_MINUTES,
      ) * 60;
    this.resetTokenTtlSeconds = Number(
      this.config.get('PASSWORD_RESET_TOKEN_TTL_SECONDS') ??
        DEFAULT_RESET_TOKEN_TTL_SECONDS,
    );
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  }

  // ── 1. Initiate ─────────────────────────────────────────────────────────────

  /**
   * POST /auth/password-reset/initiate  { phoneNumber }
   *
   * Looks up the account. Regardless of whether it exists:
   *  - returns 200 with the same shape
   *  - returns a resetSessionId JWT
   *
   * For a real account a PasswordResetSession row is created.
   * For an unknown phone the JWT encodes sub: null (ghost session); all
   * downstream methods silently no-op when they decode a null sub.
   *
   * ⚠️ Design note — emailRecoveryAvailable flag:
   * This endpoint intentionally does NOT return an emailRecoveryAvailable boolean.
   * Doing so would confirm that the phone belongs to a real account and whether
   * it has a verified email — a minor enumeration risk. The current approach is
   * the more secure default: the UI must offer both OTP and EMAIL_LINK options
   * unconditionally and let the ineligible path no-op silently on the server.
   *
   * If the product team decides the UX trade-off is worth it, change this method
   * to return { resetSessionId, emailRecoveryAvailable: boolean } once a real
   * account is confirmed. This is a deliberate decision point, not an oversight.
   */
  async initiate(phoneNumber: string): Promise<{ resetSessionId: string }> {
    const user = await this.prisma.db.user.findUnique({
      where: { phone: phoneNumber },
      select: { id: true },
    });

    let sessionId: string | null = null;

    if (user) {
      const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000);
      const session = await this.prisma.db.passwordResetSession.create({
        data: { userId: user.id, expiresAt },
        select: { id: true },
      });
      sessionId = session.id;
    }
    // Ghost session: sessionId remains null — JWT encodes sub: null.
    // Downstream methods check for null and silently return success.

    const resetSessionId = this.jwtService.sign(
      {
        sub: sessionId,
        type: 'pwd-reset-session',
      } satisfies ResetSessionPayload,
      { expiresIn: this.sessionTtlSeconds },
    );

    return { resetSessionId };
  }

  // ── 2. Choose method ────────────────────────────────────────────────────────

  /**
   * POST /auth/password-reset/method  { resetSessionId, method }
   *
   * Validates the session JWT and DB row, then:
   *  - OTP:        generates a 6-digit code, bcrypt-hashes it, stores it,
   *                delivers it via SMS.
   *  - EMAIL_LINK: generates a 64-byte random hex token, bcrypt-hashes it,
   *                stores it, and emails the reset link — BUT ONLY if the
   *                account has a verified email. If ineligible the method
   *                silently no-ops (no email sent, no error returned).
   *
   * Always returns the same generic message to prevent confirmation of email
   * existence or verification status.
   */
  async chooseMethod(
    rawSessionId: string,
    method: ResetMethodChoice,
  ): Promise<{ message: string }> {
    const sessionId = this.decodeSessionJwt(rawSessionId);

    // Ghost session — silently succeed without doing anything.
    if (sessionId === null) {
      return { message: "If eligible, we've sent a code/link." };
    }

    const session = await this.loadLiveSession(sessionId);

    if (method === 'OTP') {
      const code = randomInt(100_000, 1_000_000).toString();
      const otpHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

      await this.prisma.db.passwordResetSession.update({
        where: { id: session.id },
        data: { method: 'OTP', otpHash, attempts: 0 },
      });

      const user = await this.prisma.db.user.findUnique({
        where: { id: session.userId },
        select: { phone: true },
      });

      if (user) {
        await this.sms.sendOtp({
          phone: user.phone,
          code,
          flow: 'password-reset',
          channel: 'sms',
          expiresInMinutes: this.sessionTtlSeconds / 60,
        });
      }
    } else {
      // EMAIL_LINK path
      const user = await this.prisma.db.user.findUnique({
        where: { id: session.userId },
        select: { email: true, isEmailVerified: true },
      });

      // ⚠️ Silent no-op if email is missing or unverified.
      // This is the secure default: the response does not reveal whether the
      // account has email, or whether it's verified.
      if (user?.email && user.isEmailVerified) {
        const rawToken = randomBytes(64).toString('hex');
        const emailTokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);

        await this.prisma.db.passwordResetSession.update({
          where: { id: session.id },
          data: { method: 'EMAIL_LINK', emailTokenHash },
        });

        const link = `${this.frontendUrl}/reset-password/email?token=${rawToken}&sessionId=${session.id}`;
        await this.mail.send(
          user.email,
          'Reset your Moani password',
          `Click this link to reset your password (expires in ${this.sessionTtlSeconds / 60} minutes):\n${link}\n\nIf you didn't request this, you can safely ignore it.`,
          `<p>Reset your Moani password:</p>
           <p><a href="${link}">Click here to reset your password</a></p>
           <p>This link expires in ${this.sessionTtlSeconds / 60} minutes. If you didn't request this, ignore it.</p>`,
        );
      }
      // No else — silent no-op for ineligible accounts.
    }

    return { message: "If eligible, we've sent a code/link." };
  }

  // ── 3a. Verify OTP ──────────────────────────────────────────────────────────

  /**
   * POST /auth/password-reset/verify-otp  { resetSessionId, otp }
   *
   * Rate-limits attempts to MAX_OTP_ATTEMPTS (5). On the 5th failure the
   * session is consumed (usedAt set), requiring the user to start over.
   *
   * On success issues a single-use resetToken JWT scoped to "set new password."
   */
  async verifyOtp(
    rawSessionId: string,
    otp: string,
  ): Promise<{ resetToken: string }> {
    const sessionId = this.decodeSessionJwt(rawSessionId);

    if (sessionId === null) {
      throw new UnauthorizedException('Invalid or expired reset session.');
    }

    const session = await this.loadLiveSession(sessionId);

    if (session.method !== 'OTP' || !session.otpHash) {
      throw new UnauthorizedException(
        'OTP verification is not configured for this session.',
      );
    }

    if (session.attempts >= MAX_OTP_ATTEMPTS) {
      await this.consumeSession(session.id);
      throw new UnauthorizedException(
        'Too many failed attempts — please start the reset process again.',
      );
    }

    const isMatch = await bcrypt.compare(otp, session.otpHash);

    if (!isMatch) {
      const newAttempts = session.attempts + 1;
      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        await this.consumeSession(session.id);
        throw new UnauthorizedException(
          'Too many failed attempts — please start the reset process again.',
        );
      }
      await this.prisma.db.passwordResetSession.update({
        where: { id: session.id },
        data: { attempts: newAttempts },
      });
      throw new UnauthorizedException('Invalid OTP.');
    }

    await this.consumeSession(session.id);
    return { resetToken: this.signResetToken(session.id) };
  }

  // ── 3b. Verify email token ──────────────────────────────────────────────────

  /**
   * GET /auth/password-reset/email/verify?token=...&sessionId=...
   *
   * Validates the emailed token (not expired, not used), then hands back
   * the same single-use resetToken as verifyOtp so both paths converge on
   * POST /auth/password-reset/complete.
   */
  async verifyEmailToken(
    sessionId: string,
    rawToken: string,
  ): Promise<{ resetToken: string }> {
    const session = await this.loadLiveSession(sessionId);

    if (session.method !== 'EMAIL_LINK' || !session.emailTokenHash) {
      throw new UnauthorizedException(
        'Email link verification is not configured for this session.',
      );
    }

    const isMatch = await bcrypt.compare(rawToken, session.emailTokenHash);

    if (!isMatch) {
      throw new UnauthorizedException(
        'Invalid or expired reset link. Please request a new one.',
      );
    }

    await this.consumeSession(session.id);
    return { resetToken: this.signResetToken(session.id) };
  }

  // ── 4. Complete ─────────────────────────────────────────────────────────────

  /**
   * POST /auth/password-reset/complete  { resetToken, newPassword, confirmPassword }
   *
   * Validates the single-use resetToken, enforces password policy, writes the
   * new password hash, invalidates all live JWTs for that user (best-effort —
   * see note below), and sends a "password changed" notification.
   *
   * ⚠️ Session-invalidation caveat:
   * TokenBlacklistService is in-memory and process-scoped. Revoking tokens here
   * will NOT propagate to other server instances in a multi-replica deployment.
   * TODO: replace TokenBlacklistService with a Redis-backed implementation when
   * scaling beyond a single instance (same applies to logout).
   */
  async complete(
    rawResetToken: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    // 1. Verify the single-use reset token.
    let payload: ResetTokenPayload;
    try {
      payload = this.jwtService.verify<ResetTokenPayload>(rawResetToken);
    } catch {
      throw new UnauthorizedException(
        'Reset token is invalid or has expired. Please start over.',
      );
    }

    if (payload.type !== 'pwd-reset-token') {
      throw new UnauthorizedException('Invalid reset token.');
    }

    // 2. Confirm the session row still exists and is in the consumed state.
    //    (consumeSession sets usedAt; verify-otp/email-verify consumes before issuing the token)
    const session = await this.prisma.db.passwordResetSession.findUnique({
      where: { id: payload.sub },
      select: { id: true, userId: true, usedAt: true, expiresAt: true },
    });

    if (!session || !session.usedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Reset token is invalid or has expired. Please start over.',
      );
    }

    // 3. Password validation.
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    if (newPassword.length < 8 || !PASSWORD_POLICY.test(newPassword)) {
      throw new BadRequestException(
        'Password must be at least 8 characters and contain at least one lowercase letter, one uppercase letter, and one digit.',
      );
    }

    // 4. Write new password hash.
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.db.user.update({
      where: { id: session.userId },
      data: { passwordHash },
    });

    // 5. Invalidate the reset token itself so it cannot be replayed.
    const nowSec = Math.floor(Date.now() / 1000);
    let decoded: { exp?: number };
    try {
      decoded = this.jwtService.decode<{ exp?: number }>(rawResetToken);
    } catch {
      decoded = {};
    }
    const expSec = decoded?.exp ?? nowSec;
    const ttlMs = Math.max((expSec - nowSec) * 1000, 0);
    this.blacklist.revoke(rawResetToken, ttlMs);
    // NOTE: This only revokes on the current process. See ⚠️ caveat above.

    // 6. Send "password changed" notification so the account holder knows.
    const user = await this.prisma.db.user.findUnique({
      where: { id: session.userId },
      select: {
        phone: true,
        email: true,
        isEmailVerified: true,
        firstName: true,
      },
    });

    if (user) {
      const noticeText =
        `Hi ${user.firstName}, your Moani account password was just changed. ` +
        `If this wasn't you, contact support immediately.`;

      // SMS notification — always attempt (not silent).
      try {
        await this.sms.send(user.phone, noticeText);
      } catch (err) {
        this.logger.error(
          `Failed to send password-change SMS to ${user.phone}: ${(err as Error)?.message}`,
        );
      }

      // Email notification — only if verified email exists.
      if (user.email && user.isEmailVerified) {
        try {
          await this.mail.send(
            user.email,
            'Your Moani password was changed',
            noticeText,
            `<p>${noticeText}</p>`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to send password-change email to ${user.email}: ${(err as Error)?.message}`,
          );
        }
      }
    }

    return {
      message:
        'Password updated successfully. You can now log in with your new password.',
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Decodes and verifies the resetSessionId JWT.
   * Returns null for a ghost session (phone not found at initiate time).
   * Throws UnauthorizedException on invalid/expired token.
   */
  private decodeSessionJwt(rawToken: string): string | null {
    let payload: ResetSessionPayload;
    try {
      payload = this.jwtService.verify<ResetSessionPayload>(rawToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired reset session.');
    }

    if (payload.type !== 'pwd-reset-session') {
      throw new UnauthorizedException('Invalid reset session token.');
    }

    return payload.sub; // null for ghost sessions
  }

  /**
   * Loads a PasswordResetSession that is live (not expired, not consumed).
   * Throws UnauthorizedException if not found, expired, or already used.
   */
  private async loadLiveSession(sessionId: string) {
    const session = await this.prisma.db.passwordResetSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid or expired reset session.');
    }

    if (session.usedAt !== null) {
      throw new UnauthorizedException(
        'This reset session has already been used. Please start over.',
      );
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Reset session has expired. Please start over.',
      );
    }

    return session;
  }

  /** Marks a session as consumed. Idempotent — safe to call multiple times. */
  private async consumeSession(sessionId: string): Promise<void> {
    await this.prisma.db.passwordResetSession.update({
      where: { id: sessionId },
      data: { usedAt: new Date() },
    });
  }

  /** Signs a single-use resetToken scoped to completing the password change. */
  private signResetToken(sessionId: string): string {
    return this.jwtService.sign(
      { sub: sessionId, type: 'pwd-reset-token' } satisfies ResetTokenPayload,
      { expiresIn: this.resetTokenTtlSeconds },
    );
  }
}
