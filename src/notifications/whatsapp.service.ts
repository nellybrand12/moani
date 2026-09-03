import { Injectable, Logger } from '@nestjs/common';
import { isAfricasTalkingConfigured } from './sms.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require('africastalking') as (opts: {
  apiKey: string;
  username: string;
}) => { WHATSAPP: any };

export function isAtWhatsappConfigured(): boolean {
  if (!isAfricasTalkingConfigured()) return false;
  const from = process.env['AT_WHATSAPP_NUMBER']?.trim();
  if (!from) return false;
  const lowerFrom = from.toLowerCase();
  return (
    lowerFrom !== 'not-set-yet' &&
    !lowerFrom.startsWith('your-') &&
    !lowerFrom.includes('placeholder')
  );
}

/**
 * WhatsappService — WhatsApp message delivery via Africa's Talking.
 *
 * Stubs to a console log when AT credentials / AT_WHATSAPP_NUMBER are absent or placeholder.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  private readonly whatsapp: any;
  private readonly from: string;
  private isConfigured: boolean;

  constructor() {
    this.isConfigured = isAtWhatsappConfigured();
    this.from = process.env['AT_WHATSAPP_NUMBER']?.trim() ?? '';

    if (!this.isConfigured) {
      this.whatsapp = null;
      this.logger.warn(
        "Africa's Talking WhatsApp credentials not configured or placeholder detected — WhatsApp delivery is stubbed.",
      );
    } else {
      try {
        const apiKey = process.env['AT_API_KEY']!.trim();
        const username = process.env['AT_USERNAME']!.trim();
        const at = AfricasTalking({ apiKey, username });
        this.whatsapp = at.WHATSAPP;
      } catch (error) {
        this.whatsapp = null;
        this.isConfigured = false;
        this.logger.error(
          `Failed to initialize Africa's Talking WhatsApp SDK: ${(error as Error)?.message}. Falling back to stub mode.`,
        );
      }
    }
  }

  async send(phone: string, message: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.log(`[WHATSAPP STUB] To: ${phone} | Message: ${message}`);
      return;
    }

    try {
      await this.whatsapp.sendMessage({
        waNumber: this.from,
        phoneNumber: phone,
        body: {
          message,
        },
      });
    } catch (err) {
      this.logger.error(
        `Africa's Talking WhatsApp delivery failed to ${phone}: ${(err as Error)?.message}`,
      );
      this.logger.warn(`[WHATSAPP FALLBACK] To: ${phone} | Message: ${message}`);
      throw err;
    }
  }
}


