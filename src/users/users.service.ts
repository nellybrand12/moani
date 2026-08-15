import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../lib/database/prisma/prisma.service';
import type { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
   * 404s first so callers always get a meaningful error on bad ids.
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    // Validate existence before attempting update
    await this.findOne(id);

    const updated = await this.prisma.db.user.update({
      where: { id },
      data: dto,
    });

    return new UserEntity(updated);
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
