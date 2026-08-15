import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * UpdateUserDto — fields the user may update via PATCH /users/:id.
 *
 * Deliberately excludes phone, password, and transactionPin.
 * Those require re-verification / re-auth and belong in dedicated endpoints.
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
}
