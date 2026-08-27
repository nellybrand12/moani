import { IsPhoneNumber } from 'class-validator';

export class InitiatePasswordResetDto {
  /** The phone number on the account the user wants to recover. */
  @IsPhoneNumber('CM')
  phoneNumber: string;
}
