import { Module } from '@nestjs/common';
import { EmailOtpService } from '../auth/email-otp.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, EmailOtpService],
  exports: [UsersService, EmailOtpService], // AuthModule needs UsersService for GET /auth/me
})
export class UsersModule {}
