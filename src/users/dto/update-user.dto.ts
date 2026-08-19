import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * UpdateUserDto — fields the user may update via PATCH /users/:id.
 *
 * Supports updating firstName, lastName, email, profilePicture,
 * and transactionPin (which requires password for verification).
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  profilePicture?: string;

  /** New 4 to 6 digit transaction PIN */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'transactionPin must be 4 to 6 digits',
  })
  transactionPin?: string;

  /** Current account password required to verify identity when changing transaction PIN */
  @IsOptional()
  @IsString()
  password?: string;
}
