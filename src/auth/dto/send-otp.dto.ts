import { IsIn, IsOptional, IsPhoneNumber } from 'class-validator';

export type OtpChannel = 'sms' | 'whatsapp';

export class SendOtpDto {
  @IsPhoneNumber('CM')
  phone: string;

  /** Delivery channel for OTP: sms (default) or whatsapp */
  @IsOptional()
  @IsIn(['sms', 'whatsapp'])
  channel?: OtpChannel = 'sms';
}

