import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import { EmailOtpService } from '../auth/email-otp.service';
import type { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailOtp: EmailOtpService,
  ) {}

  /** Returns all users wrapped in UserEntity (safe, no hashes). */
  async findAll(): Promise<UserEntity[]> {
    const users = await this.prisma.db.user.findMany();
    return users.map((u) => new UserEntity(u));
  }

  /** Returns a single user or throws 404. */
  async findOne(id: string): Promise<UserEntity> {
    const user = await this.prisma.db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return new UserEntity(user);
  }

  /**
   * Updates firstName, lastName, and/or email.
   *
   * When email changes, the new address is saved as unverified
   * (isEmailVerified = false) and an OTP is sent to the new address (AC-1).
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    // Validate existence before attempting update
    const current = await this.prisma.db.user.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const emailChanging =
      dto.email !== undefined && dto.email !== current.email;

    const updated = await this.prisma.db.user.update({
      where: { id },
      data: {
        ...dto,
        // Reset verification whenever the email address changes.
        ...(emailChanging ? { isEmailVerified: false } : {}),
      },
    });

    // Send OTP after the row is persisted; if email send fails the email is
    // still saved (unverified) and the user can re-trigger via a repeat PATCH.
    if (emailChanging && dto.email) {
      await this.emailOtp.send(id, dto.email);
    }

    return new UserEntity(updated);
  }

  /**
   * Sets isEmailVerified on the user record.
   * Called by AuthController after a successful email OTP verification.
   */
  async updateEmailVerified(id: string, verified: boolean): Promise<void> {
    await this.prisma.db.user.update({
      where: { id },
      data: { isEmailVerified: verified },
    });
  }

  /**
   * Hard-deletes a user row.
   * 404s first so callers get a clear error for non-existent ids.
   */
  async remove(id: string): Promise<UserEntity> {
    // Validate existence before attempting delete
    await this.findOne(id);

    const deleted = await this.prisma.db.user.delete({ where: { id } });
    return new UserEntity(deleted);
  }
}
