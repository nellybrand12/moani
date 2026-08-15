import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * MailModule — global email delivery module.
 *
 * @Global() so any feature module can inject MailService without re-importing.
 * Import once in AppModule, never in feature modules.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
