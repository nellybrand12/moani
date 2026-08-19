import { IsIn, IsOptional, IsPhoneNumber } from 'class-validator';

export type ResetChannel = 'sms' | 'whatsapp' | 'email';

export class RequestPasswordResetDto {
  @IsPhoneNumber('CM')
  phone: string;

  /** Delivery channel for reset link: sms (default), whatsapp, or email */
  @IsOptional()
  @IsIn(['sms', 'whatsapp', 'email'])
  channel?: ResetChannel = 'sms';
}

