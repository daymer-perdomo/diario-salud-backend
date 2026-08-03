import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto, actorUserId: string) {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash: await bcrypt.hash(dto.password, 12),
          role: dto.role ?? UserRole.VIEWER,
        },
      });

      await this.audit.record({
        entityType: 'User',
        entityId: user.id,
        action: 'CREATED',
        actorType: 'HUMAN',
        actorId: actorUserId,
        payload: { email: user.email, role: user.role },
      });

      const { passwordHash, ...safeUser } = user;
      return safeUser;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Ya existe un usuario con el email ${dto.email}`);
      }
      throw err;
    }
  }
}
