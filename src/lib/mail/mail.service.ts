import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

/**
 * MailService — email delivery via Resend.
 *
 * In development (RESEND_API_KEY absent or set to 'dev'), the service stubs
 * the send and logs to the console — same pattern as SmsService.
 *
 * In production set:
 *   RESEND_API_KEY   — your Resend API key
 *   RESEND_FROM_EMAIL — verified sender address (e.g. noreply@moani.app)
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly isStub: boolean;

  constructor() {
    const apiKey = process.env['RESEND_API_KEY'];
    this.from = process.env['RESEND_FROM_EMAIL'] ?? 'noreply@moani.app';
    this.isStub = !apiKey || apiKey === 'dev';

    if (this.isStub) {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not set — email delivery is stubbed. Set it for real sends.',
      );
    } else {
      this.resend = new Resend(apiKey);
    }
  }

  /**
   * Send a plain-text + HTML email.
   *
   * @param to      Recipient address
   * @param subject Email subject line
   * @param text    Plain-text body (always include for accessibility / spam filters)
   * @param html    HTML body (optional; falls back to text wrapped in <p>)
   */
  async send(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    if (this.isStub) {
      this.logger.log(
        `[MAIL STUB] To: ${to} | Subject: ${subject} | Body: ${text}`,
      );
      return;
    }

    await this.resend!.emails.send({
      from: this.from,
      to,
      subject,
      text,
      html: html ?? `<p>${text}</p>`,
    });
  }
}
