import { IsString } from 'class-validator';

export class VerifyResetOtpDto {
  /** The reset session ID returned by POST /auth/password-reset/initiate. */
  @IsString()
  resetSessionId: string;

  /** The 6-digit OTP sent to the user's phone. */
  @IsString()
  otp: string;
}
