import { Injectable, Logger } from '@nestjs/common';

/**
 * SmsService — stub implementation of SMS delivery.
 *
 * Every other service depends only on the send() method signature.
 * Swap this implementation with a real provider (Twilio, Africa's Talking,
 * Vonage, etc.) in a single file change — no other code needs to change.
 *
 * TODO: integrate a real SMS provider before production.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  send(phone: string, message: string): Promise<void> {
    // TODO: integrate a real SMS provider before production.
    this.logger.log(`[SMS STUB] To: ${phone} | Message: ${message}`);
    return Promise.resolve();
  }
}
