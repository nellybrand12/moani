import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';
import { AdminGuard } from './admin.guard';

function makeContext(role: Role): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  it('returns true for ADMIN role', () => {
    expect(guard.canActivate(makeContext(Role.ADMIN))).toBe(true);
  });

  it('throws ForbiddenException for USER role', () => {
    expect(() => guard.canActivate(makeContext(Role.USER))).toThrow(
      ForbiddenException,
    );
  });
});
