import { IsPhoneNumber } from 'class-validator';

export class SendOtpDto {
  @IsPhoneNumber('CM')
  phone: string;
}
