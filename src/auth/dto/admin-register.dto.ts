import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * AdminRegisterDto — fields required for admin account creation.
 *
 * Admins provide phone (for OTP), email (required), password, and name.
 * No dateOfBirth or transactionPin — those are user-only fields.
 */
export class AdminRegisterDto {
  @IsPhoneNumber('CM')
  phone: string;

  /** 6-digit numeric OTP received via SMS */
  @IsString()
  @Length(6, 6)
  otp: string;

  @IsEmail()
  email: string;

  /**
   * Must contain at least one lowercase letter, one uppercase letter,
   * and one digit. Minimum 8 characters.
   */
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one lowercase letter, one uppercase letter, and one digit',
  })
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  permissionsLevel?: number;
}
