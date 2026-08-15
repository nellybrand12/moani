import { Exclude } from 'class-transformer';
import type { Role } from '../../../generated/prisma/client';

/**
 * UserEntity — the safe public representation of a User row.
 *
 * passwordHash and transactionPinHash are excluded from serialization.
 * These fields are only stripped from JSON responses when a global
 * ClassSerializerInterceptor is registered in main.ts (which it is).
 */
export class UserEntity {
  id: string;
  phone: string;
  isPhoneVerified: boolean;
  email: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  role: Role;
  createdAt: Date;
  updatedAt: Date;

  @Exclude()
  passwordHash: string;

  @Exclude()
  transactionPinHash: string;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
