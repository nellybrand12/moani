import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require('africastalking') as (opts: {
  apiKey: string;
  username: string;
}) => { SMS: any };

/**
 * SmsService — SMS delivery via Africa's Talking.
 *
 * Stubs to a console log when AT_API_KEY is absent (dev / CI).
 * Set AT_API_KEY and AT_USERNAME in production.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private readonly sms: any;
  private readonly isStub: boolean;

  constructor() {
    const apiKey = process.env['AT_API_KEY'];
    const username = process.env['AT_USERNAME'];
    this.isStub = !apiKey || apiKey === 'dev';

    if (this.isStub) {
      this.sms = null;
      this.logger.warn(
        'AT_API_KEY not set — SMS delivery is stubbed. Set it for real sends.',
      );
    } else {
      const at = AfricasTalking({ apiKey: apiKey!, username: username! });
      this.sms = at.SMS;
    }
  }

  async send(phone: string, message: string): Promise<void> {
    if (this.isStub) {
      this.logger.log(`[SMS STUB] To: ${phone} | Message: ${message}`);
      return;
    }
    await this.sms.send({ to: [phone], message });
  }
}
