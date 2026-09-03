import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { EmailOtpService } from './email-otp.service';
import { PasswordResetService } from './password-reset.service';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { ChooseResetMethodDto } from './dto/choose-reset-method.dto';
import { CompletePasswordResetDto } from './dto/complete-password-reset.dto';
import { InitiatePasswordResetDto } from './dto/initiate-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { MerchantRegisterDto } from './dto/merchant-register.dto';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
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

  /** POST /auth/admin/register — OTP-verified admin registration + immediate JWT */
  @Post('admin/register')
  registerAdmin(@Body() dto: AdminRegisterDto) {
    return this.authService.registerAdmin(dto);
  }

  /** POST /auth/merchant/register — OTP-verified merchant registration + immediate JWT */
  @Post('merchant/register')
  registerMerchant(@Body() dto: MerchantRegisterDto) {
    return this.authService.registerMerchant(dto);
  }

  /** POST /auth/login — email-or-phone + password → JWT */
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

  // ── Forgot-password flow ──────────────────────────────────────────────────

  /**
   * POST /auth/password-reset/initiate
   *
   * Step 1: Submit phone number → receive a resetSessionId JWT.
   * Always returns 200 with the same shape, regardless of whether the phone
   * number belongs to a real account (anti-enumeration).
   *
   * Rate-limited to 3 requests per minute per IP.
   */
  @Post('password-reset/initiate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  initiatePasswordReset(@Body() dto: InitiatePasswordResetDto) {
    return this.passwordReset.initiate(dto.phoneNumber);
  }

  /**
   * POST /auth/password-reset/method
   *
   * Step 2: Choose OTP (SMS) or EMAIL_LINK.
   * Always returns the same generic success message to avoid leaking email
   * existence/verification status. Rate-limited to 3/min per IP.
   */
  @Post('password-reset/method')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  chooseResetMethod(@Body() dto: ChooseResetMethodDto) {
    return this.passwordReset.chooseMethod(dto.resetSessionId, dto.method);
  }

  /**
   * POST /auth/password-reset/verify-otp
   *
   * Step 3a: Submit the 6-digit OTP received by SMS.
   * Rate-limited per session by the service (5 attempts then session locked).
   * On success returns a single-use resetToken.
   */
  @Post('password-reset/verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordReset.verifyOtp(dto.resetSessionId, dto.otp);
  }

  /**
   * GET /auth/password-reset/email/verify?token=...&sessionId=...
   *
   * Step 3b: Validate the emailed reset link.
   * On success returns the same single-use resetToken as the OTP path,
   * so both paths converge on POST /auth/password-reset/complete.
   */
  @Get('password-reset/email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmailResetToken(
    @Query('sessionId') sessionId: string,
    @Query('token') token: string,
  ) {
    return this.passwordReset.verifyEmailToken(sessionId, token);
  }

  /**
   * POST /auth/password-reset/complete
   *
   * Step 4: Set the new password using the single-use resetToken.
   * Validates password match + policy, updates the hash, invalidates the
   * resetToken, and sends a "password changed" notification.
   */
  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  completePasswordReset(@Body() dto: CompletePasswordResetDto) {
    return this.passwordReset.complete(
      dto.resetToken,
      dto.newPassword,
      dto.confirmPassword,
    );
  }
}
