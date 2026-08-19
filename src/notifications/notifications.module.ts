import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { WhatsappService } from './whatsapp.service';

@Global()
@Module({
  providers: [SmsService, WhatsappService],
  exports: [SmsService, WhatsappService],
})
export class NotificationsModule {}
