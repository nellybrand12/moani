import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';
import { UserAccessGuard } from './user-access.guard';

function makeContext(
  userId: string,
  role: Role,
  paramId: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: userId, role },
        params: { id: paramId },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('UserAccessGuard', () => {
  let guard: UserAccessGuard;

  beforeEach(() => {
    guard = new UserAccessGuard();
  });

  it('allows ADMIN to access any :id', () => {
    expect(
      guard.canActivate(makeContext('admin-id', Role.ADMIN, 'other-user-id')),
    ).toBe(true);
  });

  it('allows a USER to access their own :id', () => {
    expect(guard.canActivate(makeContext('user-1', Role.USER, 'user-1'))).toBe(
      true,
    );
  });

  it('throws ForbiddenException when USER tries to access another :id', () => {
    expect(() =>
      guard.canActivate(makeContext('user-1', Role.USER, 'user-2')),
    ).toThrow(ForbiddenException);
  });

  it('allows a MERCHANT to access their own :id', () => {
    expect(
      guard.canActivate(makeContext('merchant-1', Role.MERCHANT, 'merchant-1')),
    ).toBe(true);
  });

  it('throws ForbiddenException when MERCHANT tries to access another :id', () => {
    expect(() =>
      guard.canActivate(makeContext('merchant-1', Role.MERCHANT, 'user-2')),
    ).toThrow(ForbiddenException);
  });
});
