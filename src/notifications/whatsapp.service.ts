import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require('africastalking') as (opts: {
  apiKey: string;
  username: string;
}) => { WHATSAPP: any };

/**
 * WhatsappService — WhatsApp message delivery via Africa's Talking.
 *
 * Stubs to a console log when AT_API_KEY / AT_WHATSAPP_NUMBER are absent.
 * Set AT_API_KEY, AT_USERNAME, and AT_WHATSAPP_NUMBER in production.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  private readonly whatsapp: any;
  private readonly from: string;
  private readonly isStub: boolean;

  constructor() {
    const apiKey = process.env['AT_API_KEY'];
    const username = process.env['AT_USERNAME'];
    this.from = process.env['AT_WHATSAPP_NUMBER'] ?? '';
    this.isStub = !apiKey || apiKey === 'dev' || !this.from;

    if (this.isStub) {
      this.whatsapp = null;
      this.logger.warn(
        'AT_API_KEY or AT_WHATSAPP_NUMBER not set — WhatsApp delivery is stubbed.',
      );
    } else {
      const at = AfricasTalking({ apiKey: apiKey!, username: username! });
      this.whatsapp = at.WHATSAPP;
    }
  }

  async send(phone: string, message: string): Promise<void> {
    if (this.isStub) {
      this.logger.log(`[WHATSAPP STUB] To: ${phone} | Message: ${message}`);
      return;
    }
    await this.whatsapp.sendMessage({
      from: this.from,
      to: phone,
      message,
    });
  }
}
