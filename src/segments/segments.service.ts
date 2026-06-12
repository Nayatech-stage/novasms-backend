import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import IORedis from 'ioredis';

export interface SegmentFilter {
  field:
    | 'tags'
    | 'country'
    | 'createdAt'
    | 'lastPurchase'
    | 'openRate'
    | 'city';
  op: 'contains' | 'eq' | 'neq' | 'gte' | 'lte' | 'in';
  value: string | string[];
}

export interface SegmentCriteria {
  operator: 'AND' | 'OR';
  filters: SegmentFilter[];
}

interface CreateSegmentDto {
  name: string;
  criteria: SegmentCriteria;
}

interface UpdateSegmentDto {
  name?: string;
  criteria?: SegmentCriteria;
}

@Injectable()
export class SegmentsService implements OnModuleDestroy {
  private readonly logger = new Logger(SegmentsService.name);
  private readonly redis: IORedis;

  constructor(private prisma: PrismaService) {
    this.redis = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private buildWhereFromCriteria(
    accountId: string,
    criteria: SegmentCriteria,
  ): Record<string, unknown> {
    const filterConditions: Record<string, unknown>[] = criteria.filters.map(
      (filter) => {
        switch (filter.field) {
          case 'tags':
            return { tags: { has: filter.value as string } };
          case 'country':
            return {
              country:
                filter.op === 'neq'
                  ? { not: filter.value }
                  : { equals: filter.value },
            };
          case 'city':
            return {
              city:
                filter.op === 'neq'
                  ? { not: filter.value }
                  : { equals: filter.value },
            };
          case 'createdAt': {
            const dateVal = new Date(filter.value as string);
            if (filter.op === 'gte') return { createdAt: { gte: dateVal } };
            if (filter.op === 'lte') return { createdAt: { lte: dateVal } };
            return {};
          }
          case 'lastPurchase': {
            const dateVal = new Date(filter.value as string);
            if (filter.op === 'gte')
              return { lastPurchaseAt: { gte: dateVal } };
            if (filter.op === 'lte')
              return { lastPurchaseAt: { lte: dateVal } };
            return {};
          }
          case 'openRate':
            return {}; // calculated field — skip in DB filter
          default:
            return {};
        }
      },
    );

    const validConditions = filterConditions.filter(
      (c) => Object.keys(c).length > 0,
    );

    const combinedFilter =
      validConditions.length === 0
        ? {}
        : criteria.operator === 'AND'
          ? { AND: validConditions }
          : { OR: validConditions };

    return { accountId, unsubscribed: false, ...combinedFilter };
  }

  async previewCount(
    accountId: string,
    criteria: SegmentCriteria,
  ): Promise<number> {
    const cacheKey = `seg:preview:${accountId}:${JSON.stringify(criteria)}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return parseInt(cached, 10);
    } catch {
      // Redis unavailable — compute directly
    }
    const where = this.buildWhereFromCriteria(accountId, criteria);
    const count = await this.prisma.contact.count({ where: where as any });
    try {
      await this.redis.setex(cacheKey, 300, String(count)); // TTL 5 min
    } catch {
      // non-bloquant
    }
    return count;
  }

  async create(accountId: string, dto: CreateSegmentDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Le nom du segment est requis');
    }

    const contactCount = await this.previewCount(accountId, dto.criteria);

    return this.prisma.segment.create({
      data: {
        name: dto.name.trim(),
        accountId,
        criteria: dto.criteria as any,
        contactCount,
      },
    });
  }

  async findAll(accountId: string, page = 1, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    return this.prisma.segment.findMany({
      where: { accountId },
      orderBy: { id: 'desc' },
      take,
      skip,
    });
  }

  async findOne(accountId: string, id: string) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment || segment.accountId !== accountId) {
      throw new NotFoundException('Segment introuvable');
    }
    return segment;
  }

  async update(accountId: string, id: string, dto: UpdateSegmentDto) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment || segment.accountId !== accountId) {
      throw new NotFoundException('Segment introuvable');
    }

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Le nom du segment est requis');
    }

    let contactCount = segment.contactCount;
    if (dto.criteria) {
      contactCount = await this.previewCount(accountId, dto.criteria);
    }

    return this.prisma.segment.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.criteria && { criteria: dto.criteria as any }),
        contactCount,
      },
    });
  }

  async remove(accountId: string, id: string) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment || segment.accountId !== accountId) {
      throw new NotFoundException('Segment introuvable');
    }
    return this.prisma.segment.delete({ where: { id } });
  }

  /**
   * Rafraîchit le compteur de contacts d'un segment existant.
   * Utile pour la mise à jour automatique après import de contacts.
   */
  async refreshCount(accountId: string, id: string) {
    const segment = await this.findOne(accountId, id);
    const contactCount = await this.previewCount(
      accountId,
      segment.criteria as unknown as SegmentCriteria,
    );
    return this.prisma.segment.update({
      where: { id },
      data: { contactCount },
    });
  }
}
