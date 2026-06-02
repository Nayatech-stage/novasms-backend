/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  AutomationStatus,
  CampaignStatus,
  Contact,
  Segment,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  private static readonly SEGMENT_CACHE_TTL_SECONDS = 300;
  private static readonly CONTACT_COUNT_CACHE_TTL_SECONDS = 300;

  constructor(
    private prisma: PrismaService,
    private segmentRecalculationService: SegmentRecalculationService,
    private eventEmitter: EventEmitter2,
  ) {}

  createAuditLog(
    accountId: string,
    action: string,
    details: any,
  ): Promise<any> {
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

  async findAll(
    accountId: string,
    params: any,
  ): Promise<{
    data: Contact[];
    nextCursor: string | null;
    total: number;
  }> {
    const limit = Math.min(params.limit || 20, 100);
    const isUnfiltered =
      !params.search &&
      !params.location &&
      !params.tag &&
      !params.dateAddedFrom &&
      !params.dateAddedTo;
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
      // Keyset pagination must use the same unique ordering field as the cursor.
      orderBy: { id: 'asc' },
      take: limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
    });
    let nextCursor: string | null = null;
    if (contacts.length > limit) {
      const n = contacts.pop();
      nextCursor = n?.id || null;
    }
    let total: number;
    if (isUnfiltered) {
      const countCacheKey = `contacts:count:${accountId}`;
      try {
        const cachedTotal = await redisConnection.get(countCacheKey);
        if (cachedTotal) {
          total = parseInt(cachedTotal, 10);
        } else {
          total = await this.prisma.contact.count({ where });
          await redisConnection.set(
            countCacheKey,
            String(total),
            'EX',
            ContactsService.CONTACT_COUNT_CACHE_TTL_SECONDS,
          );
        }
      } catch {
        total = await this.prisma.contact.count({ where });
      }
    } else {
      total = await this.prisma.contact.count({ where });
    }

    return {
      data: contacts,
      nextCursor,
      total,
    };
  }

  findById(accountId: string, id: string): Promise<Contact | null> {
    return this.prisma.contact.findFirst({ where: { id, accountId } });
  }

  async create(accountId: string, data: any): Promise<Contact> {
    try {
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
      await this.invalidateContactCountCache(accountId);
      this.eventEmitter.emit('contact.added', {
        accountId,
        contactId: c.id,
        contact: c,
      });
      await this.emitSegmentJoinedEvents(accountId, c);
      return c;
    } catch (err: unknown) {
      // Handle unique constraint violations: return existing contact instead of error
      // Prisma unique constraint code is P2002
      const maybe = err as any;
      if (maybe && maybe.code === 'P2002') {
        // Try to find existing contact by email or phone
        if (data.email) {
          const existing = await this.prisma.contact.findFirst({
            where: { accountId, email: data.email },
          });
          if (existing) return Object.assign(existing, { alreadyExists: true });
        }
        if (data.phone) {
          const existing = await this.prisma.contact.findFirst({
            where: { accountId, phone: data.phone },
          });
          if (existing) return Object.assign(existing, { alreadyExists: true });
        }
      }
      throw err;
    }
  }

  async remove(accountId: string, id: string): Promise<{ success: true }> {
    await this.prisma.contact.delete({ where: { id, accountId } });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    await this.invalidateContactCountCache(accountId);
    return { success: true };
  }

  async update(
    accountId: string,
    id: string,
    data: any,
  ): Promise<Contact | null> {
    const existing = await this.prisma.contact.findFirst({
      where: { id, accountId },
    });
    if (!existing) return null;
    const payload: any = {};
    if (data.firstName !== undefined) payload.firstName = data.firstName;
    if (data.lastName !== undefined) payload.lastName = data.lastName;
    if (data.email !== undefined) payload.email = data.email;
    if (data.phone !== undefined) payload.phone = data.phone;
    if (data.location !== undefined) payload.location = data.location;
    if (data.tags !== undefined) payload.tags = data.tags;
    if (data.optOut !== undefined) payload.optOut = data.optOut;

    const updated = await this.prisma.contact.update({
      where: { id },
      data: payload,
    });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    await this.invalidateContactCountCache(accountId);
    await this.emitSegmentJoinedEvents(accountId, updated, existing);
    return updated;
  }

  async optOut(accountId: string, id: string): Promise<Contact | null> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, accountId },
    });
    if (!contact) return null;
    const updated = await this.prisma.contact.update({
      where: { id },
      data: { optOut: true },
    });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    await this.invalidateContactCountCache(accountId);
    return updated;
  }

  private async getMatchingSegmentIds(accountId: string, contact: Contact) {
    const segments = await this.prisma.segment.findMany({
      where: { accountId, type: 'dynamic' },
      select: { id: true, criteria: true },
    });

    const matched: string[] = [];
    for (const segment of segments) {
      try {
        const parsed = this.normalizeSegmentCriteria(segment.criteria);
        const where = this.buildWhereForSegment(
          accountId,
          parsed.logic,
          parsed.rules,
        );
        const found = await this.prisma.contact.findFirst({
          where: {
            id: contact.id,
            ...where,
          },
          select: { id: true },
        });
        if (found) matched.push(segment.id);
      } catch (error) {
        this.logger.warn(
          `Impossible d'évaluer le segment ${segment.id} pour le contact ${contact.id}: ${String(error)}`,
        );
      }
    }

    return matched;
  }

  private async emitSegmentJoinedEvents(
    accountId: string,
    contact: Contact,
    previousContact?: Contact,
  ) {
    const nextSegments = await this.getMatchingSegmentIds(accountId, contact);
    const previousSegments = previousContact
      ? await this.getMatchingSegmentIds(accountId, previousContact)
      : [];

    const joinedSegments = nextSegments.filter(
      (segmentId) => !previousSegments.includes(segmentId),
    );

    for (const segmentId of joinedSegments) {
      this.eventEmitter.emit('segment.joined', {
        accountId,
        contactId: contact.id,
        segmentId,
      });
    }
  }

  async exportContact(
    accountId: string,
    id: string,
    format: 'csv' | 'json' = 'csv',
  ): Promise<string | null> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, accountId },
    });
    if (!contact) return null;

    if (format === 'json') {
      return JSON.stringify(contact, null, 2);
    }

    // CSV Format
    const headers = [
      'ID',
      'Email',
      'Téléphone',
      'Prénom',
      'Nom',
      'Localisation',
      'Tags',
      'Désabonné',
      'Date création',
    ];
    const values = [
      contact.id || '',
      contact.email || '',
      contact.phone || '',
      contact.firstName || '',
      contact.lastName || '',
      contact.location || '',
      Array.isArray(contact.tags) ? contact.tags.join(';') : '',
      contact.optOut ? 'Oui' : 'Non',
      new Date(contact.createdAt).toISOString(),
    ];

    // Escape CSV values
    const escapedValues = values.map((v: string) => {
      if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    });

    return headers.join(',') + '\n' + escapedValues.join(',');
  }

  // ✅ CORRECTION: Ajouter try-catch pour éviter les 500
  async previewSegment(
    accountId: string,
    payload: { logic: SegmentLogic; criteria: SegmentCriterion[] },
  ): Promise<{ count: number }> {
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
        await redisConnection.set(
          key,
          String(count),
          'EX',
          ContactsService.SEGMENT_CACHE_TTL_SECONDS,
        );
      } catch {
        // Ignore cache write errors
      }
      return { count };
    } catch (error: any) {
      this.logger.error('previewSegment failed: ' + error.message, error.stack);
      return { count: 0 }; // ✅ Retourner 0 au lieu de crasher
    }
  }

  listSegments(accountId: string): Promise<Segment[]> {
    return this.prisma.segment.findMany({
      where: { accountId },
      orderBy: { id: 'desc' },
    });
  }

  async listSegmentsWithContacts(
    accountId: string,
    limit?: number,
  ): Promise<any[]> {
    const segments = await this.prisma.segment.findMany({
      where: { accountId },
      orderBy: { id: 'desc' },
    });

    const results = await Promise.all(
      segments.map(async (segment) => {
        if (segment.type === 'static') {
          const contactIds = Array.isArray(segment.criteria)
            ? segment.criteria
            : (segment.criteria as any)?.contactIds || [];
          const contacts = await this.prisma.contact.findMany({
            where: {
              accountId,
              id: { in: contactIds },
              optOut: false,
            },
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
        }

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
      contactIds?: string[];
    },
  ): Promise<any> {
    const selectedContactIds = Array.isArray(payload.contactIds)
      ? Array.from(
          new Set(
            payload.contactIds.filter(
              (id) => typeof id === 'string' && id.trim().length > 0,
            ),
          ),
        )
      : [];

    if (selectedContactIds.length > 0) {
      const contactCount = await this.prisma.contact.count({
        where: {
          accountId,
          id: { in: selectedContactIds },
          optOut: false,
        },
      });

      return this.prisma.segment.create({
        data: {
          accountId,
          name: payload.name,
          type: 'static',
          criteria: { contactIds: selectedContactIds },
          contactCount,
          lastCalculated: new Date(),
        },
      });
    }

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

  async deleteSegment(
    accountId: string,
    id: string,
  ): Promise<{ success: true } | null> {
    const segment = await this.prisma.segment.findFirst({
      where: { id, accountId },
      select: { id: true },
    });

    if (!segment) {
      return null;
    }

    const automationUsingSegment = await this.prisma.automation.findFirst({
      where: {
        accountId,
        status: AutomationStatus.Active,
        triggerType: 'segment_joined',
        triggerConfig: {
          path: ['segmentId'],
          equals: id,
        },
      },
      select: { id: true },
    });

    if (automationUsingSegment) {
      throw new ConflictException(
        'Ce segment est utilisé par une automatisation active',
      );
    }

    const scheduledCampaignUsingSegment = await this.prisma.campaign.findFirst({
      where: {
        accountId,
        segmentId: id,
        status: CampaignStatus.SCHEDULED,
      },
      select: { id: true },
    });

    if (scheduledCampaignUsingSegment) {
      throw new ConflictException(
        'Ce segment est ciblé par une campagne planifiée',
      );
    }

    await this.prisma.$transaction([
      this.prisma.campaign.updateMany({
        where: {
          accountId,
          segmentId: id,
          status: CampaignStatus.DRAFT,
        },
        data: { segmentId: null },
      }),
      this.prisma.segment.delete({ where: { id } }),
    ]);

    return { success: true };
  }

  async updateSegment(
    accountId: string,
    segmentId: string,
    payload: {
      name?: string;
      logic?: SegmentLogic;
      criteria?: SegmentCriterion[];
      type?: 'dynamic' | 'static';
      contactIds?: string[];
    },
  ): Promise<any> {
    const existing = await this.prisma.segment.findFirst({
      where: { id: segmentId, accountId },
    });

    if (!existing) {
      throw new NotFoundException('Segment non trouve');
    }

    const nextName = payload.name?.trim() || existing.name || 'Segment';
    const nextType = payload.type || (existing.type as 'dynamic' | 'static');

    if (nextType === 'static') {
      const contactIds = Array.isArray(payload.contactIds)
        ? Array.from(
            new Set(
              payload.contactIds.filter(
                (id) => typeof id === 'string' && id.trim().length > 0,
              ),
            ),
          )
        : [];

      const count = await this.prisma.contact.count({
        where: {
          accountId,
          id: { in: contactIds },
          optOut: false,
        },
      });

      return this.prisma.segment.update({
        where: { id: segmentId },
        data: {
          name: nextName,
          type: 'static',
          criteria: { contactIds },
          contactCount: count,
          lastCalculated: new Date(),
        },
      });
    }

    const rules = Array.isArray(payload.criteria)
      ? payload.criteria
      : this.normalizeSegmentCriteria(existing.criteria).rules;
    const logic = payload.logic === 'OR' ? 'OR' : 'AND';

    if (rules.length === 0) {
      throw new BadRequestException(
        'Le segment doit contenir au moins un critère',
      );
    }

    const where = this.buildWhereForSegment(accountId, logic, rules);
    const count = await this.prisma.contact.count({ where });

    return this.prisma.segment.update({
      where: { id: segmentId },
      data: {
        name: nextName,
        type: 'dynamic',
        criteria: { logic, rules },
        contactCount: count,
        lastCalculated: new Date(),
      },
    });
  }

  async getSegmentWithContacts(
    accountId: string,
    segmentId: string,
  ): Promise<Record<string, unknown> | null> {
    const segments = (await this.listSegmentsWithContacts(accountId)) as Array<
      Record<string, unknown> & { id: string }
    >;
    return segments.find((segment) => segment.id === segmentId) ?? null;
  }

  /**
   * Compter les contacts actifs d'un segment
   */
  async countSegmentContacts(
    accountId: string,
    segmentId?: string,
  ): Promise<number> {
    try {
      if (!segmentId) {
        // Pas de segment → tous les contacts actifs
        return this.prisma.contact.count({
          where: {
            accountId,
            optOut: false,
          },
        });
      }

      // Récupérer le segment
      const segment = await this.prisma.segment.findUnique({
        where: { id: segmentId },
      });

      if (!segment || segment.accountId !== accountId) {
        throw new Error('Segment not found');
      }

      if (segment.type === 'static') {
        const contactIds = Array.isArray(segment.criteria)
          ? segment.criteria
          : (segment.criteria as any)?.contactIds || [];

        return this.prisma.contact.count({
          where: {
            accountId,
            id: { in: contactIds },
            optOut: false,
          },
        });
      }

      // Utiliser le contactCount déjà calculé (mis à jour par le service de recalculation)
      return segment.contactCount || 0;
    } catch (error) {
      this.logger.error(
        `Erreur lors du comptage des contacts: ${String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Récupérer les vrais contacts d'un segment pour envoi
   */
  async getSegmentContactsForCampaign(
    accountId: string,
    segmentId?: string,
  ): Promise<
    Array<{
      id: string;
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
    }>
  > {
    try {
      if (!segmentId) {
        // Tous les contacts actifs
        return this.prisma.contact.findMany({
          where: {
            accountId,
            optOut: false,
          },
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        });
      }

      // Récupérer segment et construire le where
      const segment = await this.prisma.segment.findUnique({
        where: { id: segmentId },
      });

      if (!segment || segment.accountId !== accountId) {
        throw new Error('Segment not found');
      }

      if (segment.type === 'static') {
        const contactIds = Array.isArray(segment.criteria)
          ? segment.criteria
          : (segment.criteria as any)?.contactIds || [];

        return this.prisma.contact.findMany({
          where: {
            accountId,
            id: { in: contactIds },
            optOut: false,
          },
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        });
      }

      const criteria = (segment.criteria as any)?.rules || [];
      const logic = (segment.criteria as any)?.logic || 'AND';
      const where = this.buildWhereForSegment(accountId, logic, criteria);

      return this.prisma.contact.findMany({
        where,
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `Erreur lors de la récupération des contacts: ${String(error)}`,
      );
      return [];
    }
  }

  private async invalidateContactCountCache(accountId: string) {
    try {
      await redisConnection.del(`contacts:count:${accountId}`);
    } catch {
      // Ignore cache invalidation errors
    }
  }
}
