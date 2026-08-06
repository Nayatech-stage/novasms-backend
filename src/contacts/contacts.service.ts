import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  AutomationStatus,
  CampaignStatus,
  Contact,
  Prisma,
  Segment,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnection } from '../queues/import.queue';
import { SegmentRecalculationService } from '../queues/segment.recalculation.service';
import { validatePhoneOrNull } from '../common/phone-validator.util';

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
    details: Prisma.InputJsonValue,
  ): Promise<unknown> {
    return this.prisma.auditLog.create({
      data: { accountId, action, details },
    });
  }

  public buildWhereForSegment(
    accountId: string,
    logic: SegmentLogic,
    criteria: SegmentCriterion[],
  ): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = { accountId };
    const conditions: Prisma.ContactWhereInput[] = [];

    for (const c of criteria) {
      if (!c.field || !c.operator || c.value === undefined) continue;
      let cond: Prisma.ContactWhereInput = {};

      // tags est Json? → les opérateurs varient selon le type de recherche
      if (c.field === 'tag') {
        const tagValue = String(c.value);
        if (c.operator === 'contains') {
          // Recherche d'un tag dont la valeur contient la sous-chaîne saisie.
          // On encadre la valeur de guillemets JSON pour éviter les faux positifs :
          // string_contains: '"ME"' sur ["MEMBER","VIP"] ne matche PAS (car "ME" n'est pas
          // un token complet dans ce JSON), mais matche ["ME","VIP"].
          cond = { tags: { string_contains: `"${tagValue}"` } };
        } else {
          // Match exact d'un élément (equals / in)
          cond = { tags: { array_contains: [tagValue] } };
        }
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

  public normalizeSegmentCriteria(raw: unknown): {
    logic: SegmentLogic;
    rules: SegmentCriterion[];
  } {
    const fallback = {
      logic: 'AND' as SegmentLogic,
      rules: [] as SegmentCriterion[],
    };
    if (!raw || typeof raw !== 'object') return fallback;
    const rawObj = raw as { logic?: unknown; rules?: unknown };
    const logic = rawObj.logic === 'OR' ? 'OR' : 'AND';
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
    const rules = Array.isArray(rawObj.rules)
      ? (rawObj.rules as Record<string, unknown>[])
          .map((r) => {
            if (!r || typeof r !== 'object') return null;
            const field = validFields.includes(r.field as string)
              ? (r.field as string)
              : null;
            if (!field) return null;
            const operator = validOps.includes(r.operator as string)
              ? (r.operator as string)
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
    params: {
      limit?: number;
      cursor?: string;
      search?: string;
      location?: string;
      tag?: string;
      dateAddedFrom?: string;
      dateAddedTo?: string;
    },
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
    const where: Prisma.ContactWhereInput = { accountId };
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

  async create(
    accountId: string,
    data: Omit<Prisma.ContactUncheckedCreateInput, 'accountId'> & {
      tags?: Prisma.InputJsonValue;
    },
  ): Promise<Contact> {
    // Étape 1 : création avec gestion P2002 uniquement
    let c: Contact;
    try {
      const phoneStr = typeof data.phone === 'string' ? data.phone : null;
      const phoneValidation = validatePhoneOrNull(phoneStr);
      c = await this.prisma.contact.create({
        data: {
          accountId,
          ...data,
          tags: data.tags || [],
          optOut: data.optOut || false,
          phoneStatus: phoneValidation.status,
        },
      });
    } catch (err: unknown) {
      const maybe = err as { code?: string };
      if (maybe?.code === 'P2002') {
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

    // Étape 2 : effets de bord post-création (fire-and-forget — ne doivent jamais
    // faire échouer la création d'un contact déjà enregistré en base)
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    void this.invalidateContactCountCache(accountId);
    this.eventEmitter.emit('contact.added', {
      accountId,
      contactId: c.id,
      contact: c,
    });
    void this.emitSegmentJoinedEvents(accountId, c).catch((err) =>
      this.logger.warn(
        `emitSegmentJoinedEvents échoué pour ${c.id}: ${String(err)}`,
      ),
    );

    return c;
  }

  async remove(accountId: string, id: string): Promise<{ success: true }> {
    await this.prisma.contact.delete({ where: { id, accountId } });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    await this.invalidateContactCountCache(accountId);
    return { success: true };
  }

  async bulkRemove(
    accountId: string,
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    if (!ids.length) throw new BadRequestException('Aucun identifiant fourni');
    const { count } = await this.prisma.contact.deleteMany({
      where: { accountId, id: { in: ids } },
    });
    this.segmentRecalculationService
      .addRecalculateAccountSegmentsJob(accountId)
      .catch(() => {});
    await this.invalidateContactCountCache(accountId);
    return { success: true, deleted: count };
  }

  async update(
    accountId: string,
    id: string,
    data: Partial<Prisma.ContactUncheckedUpdateInput>,
  ): Promise<Contact | null> {
    const existing = await this.prisma.contact.findFirst({
      where: { id, accountId },
    });
    if (!existing) return null;
    const payload: Prisma.ContactUncheckedUpdateInput = {};
    if (data.firstName !== undefined) payload.firstName = data.firstName;
    if (data.lastName !== undefined) payload.lastName = data.lastName;
    if (data.email !== undefined) payload.email = data.email;
    if (data.phone !== undefined) {
      payload.phone = data.phone;
      const phoneStr = typeof data.phone === 'string' ? data.phone : null;
      payload.phoneStatus = validatePhoneOrNull(phoneStr).status;
    }
    if (data.location !== undefined) payload.location = data.location;
    if (data.tags !== undefined) payload.tags = data.tags;
    if (data.optOut !== undefined) payload.optOut = data.optOut;
    if (data.birthday !== undefined) payload.birthday = data.birthday;

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
      data: { optOut: true, optOutAt: new Date() },
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

  private static readonly EXPORT_HEADERS = [
    { key: 'id', label: 'ID' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Téléphone' },
    { key: 'firstName', label: 'Prénom' },
    { key: 'lastName', label: 'Nom' },
    { key: 'location', label: 'Localisation' },
    { key: 'tags', label: 'Tags' },
    { key: 'optOut', label: 'Désabonné' },
    { key: 'createdAt', label: 'Date création' },
  ];

  private static readonly EXPORT_LIMIT = 50_000;

  async exportAll(
    accountId: string,
    format: 'csv' | 'xlsx',
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const contacts = await this.prisma.contact.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: ContactsService.EXPORT_LIMIT,
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        location: true,
        tags: true,
        optOut: true,
        createdAt: true,
      },
    });

    const rows = contacts.map((c) => ({
      id: c.id,
      email: c.email ?? '',
      phone: c.phone ?? '',
      firstName: c.firstName ?? '',
      lastName: c.lastName ?? '',
      location: c.location ?? '',
      tags: Array.isArray(c.tags) ? (c.tags as string[]).join(';') : '',
      optOut: c.optOut ? 'Oui' : 'Non',
      createdAt: new Date(c.createdAt).toISOString(),
    }));

    const date = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const escapeCell = (v: string) =>
        v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v;

      const headerLine = ContactsService.EXPORT_HEADERS.map(
        (h) => h.label,
      ).join(',');
      const lines = rows.map((r) =>
        ContactsService.EXPORT_HEADERS.map((h) =>
          escapeCell(String(r[h.key as keyof typeof r] ?? '')),
        ).join(','),
      );
      const csv = [headerLine, ...lines].join('\n');
      return {
        buffer: Buffer.from('﻿' + csv, 'utf-8'),
        contentType: 'text/csv; charset=utf-8',
        fileName: `contacts-${date}.csv`,
      };
    }

    // XLSX via exceljs
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NovaSMS';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Contacts');

    sheet.columns = ContactsService.EXPORT_HEADERS.map((h) => ({
      header: h.label,
      key: h.key,
      width: 22,
    }));

    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow(row);
    }

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(xlsxBuffer),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `contacts-${date}.xlsx`,
    };
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
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      this.logger.error('previewSegment failed: ' + e.message, e.stack);
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
    const segment = await this.prisma.segment.findFirst({
      where: { id: segmentId, accountId },
    });
    if (!segment) return null;

    const contactSelect = {
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
    };

    if (segment.type === 'static') {
      const contactIds = Array.isArray(segment.criteria)
        ? segment.criteria
        : (segment.criteria as any)?.contactIds || [];
      const contacts = await this.prisma.contact.findMany({
        where: { accountId, id: { in: contactIds }, optOut: false },
        orderBy: { createdAt: 'desc' },
        select: contactSelect,
      });
      return { ...segment, contacts };
    }

    if (segment.type === 'dynamic') {
      const parsed = this.normalizeSegmentCriteria(segment.criteria);
      const where = this.buildWhereForSegment(
        accountId,
        parsed.logic,
        parsed.rules,
      );
      const contacts = await this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: contactSelect,
      });
      return { ...segment, contacts };
    }

    return { ...segment, contacts: [] };
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

  async addTags(
    accountId: string,
    contactId: string,
    newTags: string[],
  ): Promise<{ contact: Contact | null; addedTags: string[] }> {
    const contact = await this.findById(accountId, contactId);
    if (!contact) throw new NotFoundException('Contact non trouvé');
    const existingTags = Array.isArray(contact.tags)
      ? (contact.tags as string[])
      : [];
    const mergedTags = [...new Set([...existingTags, ...newTags])];
    const updated = await this.update(accountId, contactId, {
      tags: mergedTags,
    });
    const addedTags = newTags.filter((t) => !existingTags.includes(t));
    return { contact: updated, addedTags };
  }

  async addNote(
    accountId: string,
    contactId: string,
    content: string,
  ): Promise<{ id: string; content: string; createdAt: string }[]> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, accountId },
    });
    if (!contact) throw new NotFoundException('Contact introuvable');

    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newNote = { id: noteId, content, createdAt: now };

    await this.prisma.$executeRaw`
      UPDATE contacts
      SET notes = COALESCE(notes, '[]'::jsonb) || ${JSON.stringify([newNote])}::jsonb
      WHERE id = ${contactId}::uuid AND "accountId" = ${accountId}
    `;

    const rows = await this.prisma.$queryRaw<{ notes: unknown }[]>`
      SELECT notes FROM contacts WHERE id = ${contactId}::uuid
    `;
    const notes = rows[0]?.notes;
    return Array.isArray(notes)
      ? (notes as { id: string; content: string; createdAt: string }[])
      : [newNote];
  }

  async getHistory(
    accountId: string,
    contactId: string,
  ): Promise<
    { id: string; type: string; message: string; createdAt: string }[]
  > {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, accountId },
      include: {
        sends: {
          include: { campaign: { select: { name: true } } },
          orderBy: { sentAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!contact) throw new NotFoundException('Contact introuvable');

    const items: {
      id: string;
      type: string;
      message: string;
      createdAt: string;
    }[] = [];

    for (const send of contact.sends) {
      if (!send.sentAt) continue;
      items.push({
        id: send.campaignId + '-' + contactId,
        type: 'campaign',
        message: `Campagne "${send.campaign.name}" — statut: ${send.status.toLowerCase()}`,
        createdAt: send.sentAt.toISOString(),
      });
    }

    const rawNotes = (contact as Record<string, unknown>).notes;
    const notes = Array.isArray(rawNotes)
      ? (rawNotes as { id: string; content: string; createdAt: string }[])
      : [];
    for (const note of notes) {
      items.push({
        id: note.id,
        type: 'note',
        message: note.content,
        createdAt: note.createdAt,
      });
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return items;
  }

  private async invalidateContactCountCache(accountId: string) {
    try {
      await redisConnection.del(`contacts:count:${accountId}`);
    } catch {
      // Ignore cache invalidation errors
    }
  }
}
