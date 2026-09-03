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

/**
 * MerchantRegisterDto — fields required for merchant owner account creation.
 *
 * Merchants provide phone (for OTP), password, name, and dateOfBirth.
 * Email is optional. No transactionPin — that's a user-only field.
 */
export class MerchantRegisterDto {
  @IsPhoneNumber('CM')
  phone: string;

  /** 6-digit numeric OTP received via SMS */
  @IsString()
  @Length(6, 6)
  otp: string;

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

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  /**
   * ISO 8601 date string. Must be at least 18 years in the past.
   */
  @IsDateString()
  @MinimumAge(18, { message: 'You must be at least 18 years old to register' })
  dateOfBirth: string;
}
