import { IsString, MinLength } from 'class-validator';

export class ConfirmPasswordResetDto {
  /** The signed JWT token from the reset link query string */
  @IsString()
  token: string;

  /** New password — policy validated in PasswordResetService */
  @IsString()
  @MinLength(8)
  newPassword: string;

  /** Must match newPassword — equality validated in PasswordResetService */
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
