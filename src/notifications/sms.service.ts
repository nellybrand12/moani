import { Injectable, Logger, Optional } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require('africastalking') as (opts: {
  apiKey: string;
  username: string;
}) => { SMS: any };

export interface SendOtpOptions {
  phone: string;
  code: string;
  flow: 'signup' | 'login' | 'password-reset' | string;
  expiresInMinutes?: number;
  channel?: 'sms' | 'whatsapp';
}

/**
 * Checks whether Africa's Talking credentials are valid and configured,
 * rather than missing or using placeholder values (e.g. "not-set-yet", "dev").
 */
export function isAfricasTalkingConfigured(): boolean {
  const apiKey = process.env['AT_API_KEY']?.trim();
  const username = process.env['AT_USERNAME']?.trim();

  if (!apiKey || !username) {
    return false;
  }

  const lowerKey = apiKey.toLowerCase();
  const lowerUser = username.toLowerCase();

  const isPlaceholderKey =
    lowerKey === 'dev' ||
    lowerKey === 'not-set-yet' ||
    lowerKey === 'sandbox' || // 'sandbox' is an AT username, not a valid API key
    lowerKey.startsWith('your-') ||
    lowerKey.includes('placeholder') ||
    lowerKey.includes('replace') ||
    lowerKey.length < 10 || // AT API keys are 64-character hex strings
    /^[xX_ -]+$/.test(lowerKey); // matches dummy "xxxx..." placeholders

  const isPlaceholderUser =
    lowerUser === 'not-set-yet' ||
    lowerUser.startsWith('your-') ||
    lowerUser.includes('placeholder') ||
    lowerUser.includes('replace');

  return !isPlaceholderKey && !isPlaceholderUser;
}

/**
 * SmsService — SMS delivery and shared OTP dispatch via Africa's Talking.
 *
 * Stubs to console logs when AT credentials are not set or contain placeholders.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private readonly sms: any;
  private readonly senderId?: string;
  private isConfigured: boolean;

  constructor(@Optional() private readonly whatsapp?: WhatsappService) {
    this.isConfigured = isAfricasTalkingConfigured();
    this.senderId = process.env['AT_SENDER_ID'];

    if (!this.isConfigured) {
      this.sms = null;
      this.logger.warn(
        "Africa's Talking credentials not configured or placeholder detected — SMS delivery is stubbed to console.",
      );
    } else {
      try {
        const apiKey = process.env['AT_API_KEY']!.trim();
        const username = process.env['AT_USERNAME']!.trim();
        const at = AfricasTalking({ apiKey, username });
        this.sms = at.SMS;
      } catch (error) {
        this.sms = null;
        this.isConfigured = false;
        this.logger.error(
          `Failed to initialize Africa's Talking SDK: ${(error as Error)?.message}. Falling back to stub mode.`,
        );
      }
    }
  }

  /**
   * Single shared method for OTP dispatch across ALL flows (signup, login, password-reset).
   *
   * 1. Checks whether Africa's Talking is properly configured (not empty or placeholder).
   *    If NOT configured: logs OTP with clear flow label to console and returns successfully.
   * 2. If configured: attempts API delivery via Africa's Talking (SMS or WhatsApp).
   * 3. If the API call fails (e.g. 401 Unauthorized, insufficient balance, timeout):
   *    catches the error, logs a server error for monitoring, and deliberately falls back
   *    to console logging so the user flow is not crashed with an unhandled 500 error.
   */
  async sendOtp(options: SendOtpOptions): Promise<void> {
    const { phone, code, flow, expiresInMinutes = 10, channel = 'sms' } = options;
    const flowLabel = flow.toUpperCase();
    const message =
      flow === 'password-reset'
        ? `Your Moani password reset code is: ${code}. It expires in ${expiresInMinutes} minutes.`
        : `Your Moani verification code is: ${code}`;

    // 1. Check whether Africa's Talking credentials are configured before attempting API call
    if (!this.isConfigured) {
      this.logger.log(
        `[OTP STUB - ${flowLabel}] To: ${phone} | Code: ${code} | Message: ${message}`,
      );
      return;
    }

    // 2. Attempt real delivery via configured channel
    try {
      if (channel === 'whatsapp' && this.whatsapp) {
        try {
          await this.whatsapp.send(phone, message);
          this.logger.log(
            `[OTP SENT - ${flowLabel}] Delivered successfully to ${phone} via WhatsApp`,
          );
          return;
        } catch (whatsappErr) {
          this.logger.warn(
            `[OTP WHATSAPP FAILED] Delivery to ${phone} failed (${(whatsappErr as Error)?.message}). Falling back to SMS.`,
          );
        }
      }

      await this.sms.send({
        to: [phone],
        message,
        ...(this.senderId ? { from: this.senderId } : {}),
      });
      this.logger.log(
        `[OTP SENT - ${flowLabel}] Delivered successfully to ${phone} via SMS`,
      );
    } catch (err) {
      // 3. DELIBERATE ARCHITECTURAL DECISION (Fallback vs Throw):
      // If Africa's Talking API fails (e.g. invalid credentials 401, insufficient account balance,
      // or provider network timeout), we catch the error, log a high-visibility server error for
      // monitoring/Sentry, and FALL BACK to logging the OTP to the console rather than failing
      // the entire user request.
      //
      // Rationale:
      // 1. Prevents unhandled 500 server crashes leaking infrastructure issues to the client.
      // 2. Preserves anti-enumeration security on public auth endpoints (password reset).
      // 3. Allows staging/testing and admin troubleshooting via deployment logs even during
      //    upstream SMS provider outages.
      this.logger.error(
        `[OTP FAILED - ${flowLabel}] Africa's Talking API error sending to ${phone}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      this.logger.warn(
        `[OTP FALLBACK - ${flowLabel}] To: ${phone} | Code: ${code} | (Delivery failed, logged to console to prevent blocking flow)`,
      );
    }
  }

  /**
   * General SMS send method (e.g. notifications).
   */
  async send(phone: string, message: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.log(`[SMS STUB] To: ${phone} | Message: ${message}`);
      return;
    }

    try {
      await this.sms.send({
        to: [phone],
        message,
        ...(this.senderId ? { from: this.senderId } : {}),
      });
    } catch (err) {
      this.logger.error(
        `Africa's Talking SMS delivery failed to ${phone}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      this.logger.warn(`[SMS FALLBACK] To: ${phone} | Message: ${message}`);
    }
  }
}

