import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  /** 6-digit numeric OTP received by email */
  @IsString()
  @Length(6, 6)
  otp: string;
}
