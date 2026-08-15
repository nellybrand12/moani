import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MinimumAge } from '../../common/validators/minimum-age.validator';

export class RegisterDto {
  @IsPhoneNumber('CM')
  phone: string;

  /** 6-digit numeric OTP received via SMS */
  @IsString()
  @Length(6, 6)
  otp: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

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

  /**
   * ISO 8601 date string. Must be at least 18 years in the past.
   */
  @IsDateString()
  @MinimumAge(18, { message: 'You must be at least 18 years old to register' })
  dateOfBirth: string;

  /** 4 to 6 digit numeric transaction PIN */
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'transactionPin must be 4 to 6 digits',
  })
  transactionPin: string;
}
