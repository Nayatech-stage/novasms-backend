import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(accountId: string, page = 1, limit = 20, action?: string) {
    const skip = (page - 1) * limit;

    const where = {
      accountId,
      ...(action
        ? { action: { contains: action, mode: 'insensitive' as const } }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          action: true,
          details: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          userId: true,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
