import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';
import { MerchantGuard } from './merchant.guard';

function makeContext(role: Role): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('MerchantGuard', () => {
  let guard: MerchantGuard;

  beforeEach(() => {
    guard = new MerchantGuard();
  });

  it('returns true for MERCHANT role', () => {
    expect(guard.canActivate(makeContext(Role.MERCHANT))).toBe(true);
  });

  it('throws ForbiddenException for USER role', () => {
    expect(() => guard.canActivate(makeContext(Role.USER))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for ADMIN role', () => {
    expect(() => guard.canActivate(makeContext(Role.ADMIN))).toThrow(
      ForbiddenException,
    );
  });
});
