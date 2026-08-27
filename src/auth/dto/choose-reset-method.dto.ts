import { IsIn, IsString } from 'class-validator';

export type ResetMethodChoice = 'OTP' | 'EMAIL_LINK';

export class ChooseResetMethodDto {
  /** The reset session ID returned by POST /auth/password-reset/initiate. */
  @IsString()
  resetSessionId: string;

  /** Verification method: OTP (sent via SMS) or EMAIL_LINK (sent to account email). */
  @IsIn(['OTP', 'EMAIL_LINK'])
  method: ResetMethodChoice;
}
