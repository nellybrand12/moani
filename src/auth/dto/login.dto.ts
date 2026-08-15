import { IsPhoneNumber, IsString } from 'class-validator';

export class LoginDto {
  @IsPhoneNumber('CM')
  phone: string;

  @IsString()
  password: string;
}
