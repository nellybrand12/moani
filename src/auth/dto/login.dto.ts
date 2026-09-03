import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Ensures exactly one of `phone` or `email` is provided — not both, not neither.
 */
@ValidatorConstraint({ name: 'PhoneOrEmail', async: false })
class PhoneOrEmailConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as LoginDto;
    const hasPhone = !!obj.phone;
    const hasEmail = !!obj.email;
    return (hasPhone || hasEmail) && !(hasPhone && hasEmail);
  }

  defaultMessage() {
    return 'Provide either phone or email, not both';
  }
}

export class LoginDto {
  @IsOptional()
  @IsPhoneNumber('CM')
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  password: string;

  /**
   * Phantom field used only to trigger the PhoneOrEmail cross-field validation.
   * Not sent by the client — class-validator evaluates it on the class instance.
   */
  @Validate(PhoneOrEmailConstraint)
  private readonly _phoneOrEmail?: never;
}
