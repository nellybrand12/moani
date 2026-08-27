import { IsString, MinLength } from 'class-validator';

export class CompletePasswordResetDto {
  /** Single-use reset token issued by verify-otp or email/verify. */
  @IsString()
  resetToken: string;

  /** New password — policy validated in PasswordResetService. */
  @IsString()
  @MinLength(8)
  newPassword: string;

  /** Must match newPassword — equality validated in PasswordResetService. */
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
