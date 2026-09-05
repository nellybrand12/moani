import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';

/**
 * ThrottlerExceptionFilter — converts ThrottlerException into a clean
 * 429 response with a `Retry-After` header.
 *
 * Mobile clients use the `retryAfter` field (seconds) to show a countdown.
 * This is distinct from the 409 returned by the OTP cooldown, which uses
 * `retryAfterSeconds` — see OtpService and PasswordResetService.
 *
 * Applied globally in main.ts via app.useGlobalFilters().
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // ThrottlerException message format: "ThrottlerException: Too Many Requests"
    // The throttler doesn't expose the TTL on the exception object, so we
    // return a generic "try again later" with a conservative Retry-After.
    // Per-endpoint TTLs are documented in docs/rate-limiting.md.
    const retryAfterSeconds = 60;

    response
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .header('Retry-After', String(retryAfterSeconds))
      .json({
        statusCode: 429,
        message: 'Too many requests. Please try again later.',
        retryAfter: retryAfterSeconds,
      });
  }
}
