import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { EmailOtpService } from './email-otp.service';
import { PasswordResetService } from './password-reset.service';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import type { AuthUser } from './strategies/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly emailOtp: EmailOtpService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /**
   * POST /auth/otp/send
   *
   * Rate-limited to 3 requests per minute per IP to protect SMS costs.
   */
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  /** POST /auth/register — OTP-verified registration + immediate JWT */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** POST /auth/login — phone + password → JWT */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** GET /auth/me — returns the current authenticated user */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.findOne(user.id);
  }

  /**
   * POST /auth/logout — revokes the current JWT.
   *
   * The token is added to the in-memory blacklist and will be rejected
   * by JwtAuthGuard on subsequent requests until it naturally expires.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  logout(@Headers('authorization') authHeader: string) {
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    return this.authService.logout(token);
  }

  /**
   * POST /auth/email/verify
   *
   * Requires a valid Bearer JWT (user must be logged in).
   * Submits the 6-digit OTP received by email to confirm ownership.
   * On success sets isEmailVerified = true on the user record.
   */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async verifyEmail(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyEmailDto,
  ) {
    const currentUser = await this.usersService.findOne(user.id);
    this.emailOtp.assertHasEmail(currentUser.email);
    await this.emailOtp.verify(user.id, dto.otp);
    // Mark the email verified in the database.
    await this.usersService.updateEmailVerified(user.id, true);
    return { message: 'Email address verified successfully.' };
  }

  /**
   * POST /auth/password/request
   *
   * Public endpoint — sends a reset link to the chosen channel.
   * Rate-limited to 3 requests per minute per IP.
   */
  @Post('password/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordReset.request(dto.phone, dto.channel);
  }

  /**
   * POST /auth/password/confirm
   *
   * Public endpoint — accepts the signed JWT from the reset link
   * plus the new password (entered twice). Returns 200 on success.
   */
  @Post('password/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.passwordReset.confirm(
      dto.token,
      dto.newPassword,
      dto.confirmPassword,
    );
  }
}
