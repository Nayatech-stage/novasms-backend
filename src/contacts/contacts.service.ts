/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnection } from '../queues/import.queue';
import { SegmentRecalculationService } from '../queues/segment.recalculation.service';

export type SegmentLogic = 'AND' | 'OR';
export type SegmentCriterion = {
  field:
    | 'tag'
    | 'status'
    | 'email'
    | 'phone'
    | 'firstName'
    | 'lastName'
    | 'location'
    | 'createdAt'
    | 'lastPurchaseDate';
  operator:
    | 'equals'
    | 'contains'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'in'
    | 'notIn'
    | 'notEquals';
  value: string | number | string[];
};

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private segmentRecalculationService: SegmentRecalculationService,
  ) {}

  async createAuditLog(accountId: string, action: string, details: any) {
    return this.prisma.auditLog.create({
      data: { accountId, action, details },
    });
  }

  public buildWhereForSegment(
    accountId: string,
    logic: SegmentLogic,
    criteria: SegmentCriterion[],
  ): any {
    const where: any = { accountId };
    const conditions: any[] = [];

    for (const c of criteria) {
      if (!c.field || !c.operator || c.value === undefined) continue;
      let cond: any = {};

      // ✅ CORRECTION PRINCIPALE : tags est Json? → utiliser array_contains
      if (c.field === 'tag') {
        // Pour Json: array_contains attend un tableau
        cond = { tags: { array_contains: [String(c.value)] } };
      } else if (c.field === 'status') {
        const v = String(c.value).toLowerCase();
        if (v === 'inactive') cond = { optOut: true };
        else if (v === 'active') cond = { optOut: false };
      } else if (c.field === 'createdAt' || c.field === 'lastPurchaseDate') {
        const d = new Date(c.value as string);
        if (!isNaN(d.getTime())) cond = { [c.field]: { [c.operator]: d } };
      } else if (['gt', 'lt', 'gte', 'lte'].includes(c.operator)) {
        const n = Number(c.value);
        if (!isNaN(n)) cond = { [c.field]: { [c.operator]: n } };
      } else if (c.operator === 'in') {
        const arr = Array.isArray(c.value) ? c.value : [c.value];
        cond = { [c.field]: { in: arr } };
      } else {
        cond = { [c.field]: { contains: c.value, mode: 'insensitive' } };
      }
      if (Object.keys(cond).length > 0) conditions.push(cond);
    }
    if (conditions.length === 0) return where;
    if (conditions.length === 1) return { ...where, ...conditions[0] };
    // ✅ Utiliser AND/OR en majuscules pour Prisma
    const prismaLogic = logic.toUpperCase();
    return { ...where, [prismaLogic]: conditions };
  }

  public normalizeSegmentCriteria(raw: any): {
    logic: SegmentLogic;
    rules: SegmentCriterion[];
  } {
    const fallback = {
      logic: 'AND' as SegmentLogic,
      rules: [] as SegmentCriterion[],
    };
    if (!raw || typeof raw !== 'object') return fallback;
    const logic = raw.logic === 'OR' ? 'OR' : 'AND';
    const validFields = [
      'tag',
      'status',
      'email',
      'phone',
      'firstName',
      'lastName',
      'location',
      'createdAt',
      'lastPurchaseDate',
    ];
    const validOps = [
      'equals',
      'contains',
      'gt',
      'lt',
      'gte',
      'lte',
      'in',
      'notIn',
      'notEquals',
    ];
    const rules = Array.isArray(raw.rules)
      ? raw.rules
          .map((r: any) => {
            if (!r || typeof r !== 'object') return null;
            const field = validFields.includes(r.field) ? r.field : null;
            if (!field) return null;
            const operator = validOps.includes(r.operator)
              ? r.operator
              : 'equals';
            const value =
              ['string', 'number'].includes(typeof r.value) ||
              Array.isArray(r.value)
                ? r.value
                : '';
            return { field, operator, value };
          })
          .filter((r): r is SegmentCriterion => r !== null && r.field !== null)
      : [];
    return { logic, rules };
  }

  async findAll(accountId: string, params: any) {
    const limit = Math.min(params.limit || 20, 100);
    const where: any = { accountId };
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: 'insensitive' } },
        { lastName: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
      ];
    }
    if (params.location) where.location = params.location;
    if (params.tag) where.tags = { array_contains: [params.tag] }; // ✅ array_contains pour Json
    const contacts = await this.prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
    });
    let nextCursor: string | null = null;
    if (contacts.length > limit) {
      const n = contacts.pop();
      nextCursor = n?.id || null;
    }
    return {
      data: contacts,
      nextCursor,
      total: await this.prisma.contact.count({ where }),
    };
  }

  async findById(accountId: string, id: string) {
    return this.prisma.contact.findFirst({ where: { id, accountId } });
  }

  async create(accountId: string, data: any) {
    const c = await this.prisma.contact.create({
      data: {
        accountId,
        ...data,
        tags: data.tags || [],
        optOut: data.optOut || false,
      },
    });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    return c;
  }

  async remove(accountId: string, id: string) {
    await this.prisma.contact.delete({ where: { id, accountId } });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    return { success: true };
  }

  // ✅ CORRECTION: Ajouter try-catch pour éviter les 500
  async previewSegment(
    accountId: string,
    payload: { logic: SegmentLogic; criteria: SegmentCriterion[] },
  ) {
    try {
      if (!payload.criteria?.length) {
        return {
          count: await this.prisma.contact.count({ where: { accountId } }),
        };
      }
      const key =
        'seg:' + accountId + ':' + encodeURIComponent(JSON.stringify(payload));
      try {
        const cached = await redisConnection.get(key);
        if (cached) return { count: parseInt(cached) };
      } catch {
        // Ignore cache read errors
      }
      const where = this.buildWhereForSegment(
        accountId,
        payload.logic,
        payload.criteria,
      );
      const count = await this.prisma.contact.count({ where });
      try {
        await redisConnection.set(key, String(count), 'EX', 30);
      } catch {
        // Ignore cache write errors
      }
      return { count };
    } catch (error: any) {
      this.logger.error('previewSegment failed: ' + error.message, error.stack);
      return { count: 0 }; // ✅ Retourner 0 au lieu de crasher
    }
  }

  async listSegments(accountId: string) {
    return this.prisma.segment.findMany({
      where: { accountId },
      orderBy: { id: 'desc' },
    });
  }

  async listSegmentsWithContacts(accountId: string, limit?: number) {
    const segments = await this.prisma.segment.findMany({
      where: { accountId },
      orderBy: { id: 'desc' },
    });

    const results = await Promise.all(
      segments.map(async (segment) => {
        if (segment.type !== 'dynamic') {
          return { ...segment, contacts: [] };
        }

        const parsed = this.normalizeSegmentCriteria(segment.criteria);
        const where = this.buildWhereForSegment(
          accountId,
          parsed.logic,
          parsed.rules,
        );
        const contacts = await this.prisma.contact.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...(typeof limit === 'number' ? { take: limit } : {}),
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            tags: true,
            createdAt: true,
            optOut: true,
            location: true,
            accountId: true,
          },
        });

        return { ...segment, contacts };
      }),
    );

    return results;
  }

  async createSegment(
    accountId: string,
    payload: {
      name: string;
      logic: SegmentLogic;
      criteria: SegmentCriterion[];
    },
  ) {
    const where = this.buildWhereForSegment(
      accountId,
      payload.logic,
      payload.criteria,
    );
    const count = await this.prisma.contact.count({ where });
    return this.prisma.segment.create({
      data: {
        accountId,
        name: payload.name,
        type: 'dynamic',
        criteria: { logic: payload.logic, rules: payload.criteria },
        contactCount: count,
        lastCalculated: new Date(),
      },
    });
  }

  async deleteSegment(accountId: string, id: string) {
    const s = await this.prisma.segment.findFirst({ where: { id, accountId } });
    if (!s) return null;
    return this.prisma.segment.delete({ where: { id } });
  }
}
