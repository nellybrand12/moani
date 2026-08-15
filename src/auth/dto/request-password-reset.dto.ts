import { IsIn, IsPhoneNumber } from 'class-validator';

export class RequestPasswordResetDto {
  @IsPhoneNumber('CM')
  phone: string;

  /** Delivery channel for the reset link */
  @IsIn(['sms', 'whatsapp', 'email'])
  channel: 'sms' | 'whatsapp' | 'email';
}
