/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-base-to-string */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Patch,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  ContactsService,
  SegmentCriterion,
  SegmentLogic,
} from './contacts.service';
import { ImportService } from './import.service';
import { importQueue } from '../queues/import.queue';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { SegmentCreateSchema, SegmentPreviewSchema } from './dto/segment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, RequireRoles } from '../common';
import type { Request as ExpressRequest } from 'express';

type TenantRequest = ExpressRequest & { accountId?: string };

type ImportContactsBody = {
  fileName: string;
  mapping?: Record<string, string>;
  rows?: Array<Record<string, unknown>>;
};

type ContactUpdateBody = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  location?: string;
  tags?: string[];
  optOut?: boolean;
};

@ApiTags('Contacts')
@Controller('contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ContactsController {
  constructor(
    private importService: ImportService,
    private contactsService: ContactsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lister contacts' })
  async list(@Query() q: any, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.contactsService.findAll(accountId, {
      cursor: q.cursor,
      limit: q.limit ? +q.limit : 20,
      search: q.search,
      location: q.location,
      tag: q.tag,
      dateAddedFrom: q.dateAddedFrom,
      dateAddedTo: q.dateAddedTo,
    });
  }

  @Post('import')
  @ApiOperation({ summary: 'Importer contacts' })
  async import(
    @Body() body: ImportContactsBody,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.fileName || !Array.isArray(body.rows))
      throw new BadRequestException('Fichier ou lignes invalides');

    const mappedRows = body.rows
      .map((row) => {
        const c: any = {};
        for (const [t, s] of Object.entries(body.mapping || {})) {
          const v = row[s];
          if (v === undefined || v === null || v === '') continue;
          if (t === 'tags') {
            c.tags = String(v)
              .split(/[,;|]/)
              .map((x: string) => x.trim())
              .filter(Boolean);
          } else {
            c[t] = typeof v === 'string' ? v.trim() : String(v).trim();
          }
        }
        return c;
      })
      .filter((r: any) => r.email || r.phone);

    const result = await this.importService.startImport(
      accountId,
      body.fileName,
      mappedRows,
    );
    return {
      success: true,
      jobId: result.jobId,
      message: result.message,
      estimatedTime: result.estimatedTime,
    };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Post('import/start')
  @ApiOperation({ summary: 'Démarrer un import par chunks (retourne fileId)' })
  async startImport(
    @Body() body: { fileName?: string },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const fileId =
      (globalThis as any).crypto?.randomUUID?.() ||
      `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(os.tmpdir(), 'novasms-imports', accountId);
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${fileId}.ndjson`);
    // create empty file
    await fs.promises.writeFile(filePath, '');
    return { success: true, fileId };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Post('import/chunk')
  @ApiOperation({ summary: "Envoyer un chunk d'import (rows en JSON array)" })
  async uploadImportChunk(
    @Body() body: { fileId: string; rows: Array<Record<string, unknown>> },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.fileId || !Array.isArray(body.rows))
      throw new BadRequestException('fileId ou rows manquant');

    const dir = path.join(os.tmpdir(), 'novasms-imports', accountId);
    const filePath = path.join(dir, `${body.fileId}.ndjson`);
    try {
      await fs.promises.access(filePath);
    } catch (e) {
      throw new BadRequestException('fileId introuvable');
    }

    // Append each row as JSON line
    const lines = body.rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await fs.promises.appendFile(filePath, lines, { encoding: 'utf8' });
    return { success: true };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Post('import/complete')
  @ApiOperation({
    summary: "Finaliser l'import: assembler et lancer le traitement",
  })
  async completeImport(
    @Body() body: { fileId: string; fileName: string },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.fileId) throw new BadRequestException('fileId manquant');

    const dir = path.join(os.tmpdir(), 'novasms-imports', accountId);
    const filePath = path.join(dir, `${body.fileId}.ndjson`);
    try {
      await fs.promises.access(filePath);
    } catch (e) {
      throw new BadRequestException('fileId introuvable');
    }

    // Lance le traitement streaming dans le service
    const fileName = body.fileName || `import-${body.fileId}.ndjson`;
    const result = await this.importService.processFullImportFromFile(
      accountId,
      fileName,
      filePath,
    );
    return { success: true, result };
  }

  @Get('import/:jobId')
  @ApiOperation({ summary: "Récupérer le statut d'un import" })
  async getImportStatus(
    @Param('jobId') jobId: string,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const job = await importQueue.getJob(jobId);
    if (!job) {
      return { success: false, message: 'Job introuvable' };
    }

    const state = await job.getState();
    // If completed, try to return the job return value if available
    if (state === 'completed') {
      // job.returnvalue may contain the report if the worker returned it
      const report = job.returnvalue || null;
      return { success: true, status: 'completed', report };
    }

    return { success: true, status: state };
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Exporter un contact en CSV ou JSON' })
  async exportContact(
    @Param('id') id: string,
    @Query('format') format: 'csv' | 'json' = 'csv',
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const data = await this.contactsService.exportContact(
      accountId,
      id,
      format,
    );
    if (!data) throw new NotFoundException('Contact non trouvé');

    return {
      success: true,
      format,
      data,
      fileName: `contact-${id}.${format === 'csv' ? 'csv' : 'json'}`,
    };
  }

  @Get('by-id/:id')
  @ApiOperation({ summary: 'Recuperer un contact' })
  async getOne(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const contact = await this.contactsService.findById(accountId, id);
    if (!contact) throw new NotFoundException('Contact non trouve');
    return contact;
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Post()
  @ApiOperation({ summary: 'Creer un contact' })
  async create(@Body() body: ContactUpdateBody, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.contactsService.create(accountId, body);
  }
  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Patch(':id')
  @ApiOperation({ summary: 'Mettre a jour un contact' })
  async update(
    @Param('id') id: string,
    @Body() body: ContactUpdateBody,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const updated = await this.contactsService.update(accountId, id, body);
    if (!updated) throw new NotFoundException('Contact non trouve');
    return updated;
  }

  @Post(':id/opt-out')
  @ApiOperation({ summary: 'Desabonner un contact (opt-out)' })
  @HttpCode(HttpStatus.OK)
  async optOut(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    await this.contactsService.optOut(accountId, id);
    return { success: true };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un contact' })
  async remove(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.contactsService.remove(accountId, id);
  }

  // --- Segments ---
  @Post('segments/preview')
  @ApiOperation({ summary: 'Apercu segment' })
  @ApiResponse({
    status: 200,
    description: 'Nombre de contacts correspondant aux criteres.',
  })
  async preview(@Body() body: unknown, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    try {
      const parsed = SegmentPreviewSchema.parse(body);
      return this.contactsService.previewSegment(accountId, {
        logic: parsed.logic,
        criteria: parsed.criteria,
      });
    } catch (e: any) {
      throw new BadRequestException({
        message: 'Payload invalide',
        errors: e.errors || [e.message],
      });
    }
  }

  @Get('segments')
  @ApiOperation({ summary: 'Lister segments' })
  async listSegments(@Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    // ✅ CORRECTION: ajouter la clé 'data' avant await
    return { data: await this.contactsService.listSegments(accountId) };
  }

  @Get('segments/with-contacts')
  @ApiOperation({ summary: 'Lister segments avec leurs contacts' })
  async listSegmentsWithContacts(
    @Query('limit') limit: string | undefined,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const parsedLimit = limit ? Number(limit) : undefined;
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    return {
      data: await this.contactsService.listSegmentsWithContacts(
        accountId,
        safeLimit,
      ),
    };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Post('segments')
  @ApiOperation({ summary: 'Creer segment' })
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: 201, description: 'Segment cree avec succes.' })
  @ApiResponse({ status: 400, description: 'Donnees de segment invalides.' })
  async createSegment(@Body() body: unknown, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    try {
      const parsed = SegmentCreateSchema.parse(body);
      const segment = await this.contactsService.createSegment(accountId, {
        name: parsed.name,
        logic: parsed.logic,
        criteria: parsed.criteria,
      });
      await this.contactsService.createAuditLog(accountId, 'segment_created', {
        segmentId: segment.id,
        name: segment.name,
      });
      return {
        success: true,
        id: segment.id,
        segment,
        message: `Segment "${parsed.name}" cree pour ${segment.contactCount} contacts`,
      };
    } catch (e: any) {
      throw new BadRequestException({
        message: 'Echec creation',
        errors: e.errors || [e.message],
      });
    }
  }

  @Get('segments/:id/count')
  @ApiOperation({ summary: "Compter contacts actifs d'un segment" })
  async countSegmentContacts(
    @Param('id') segmentId: string,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    try {
      const count = await this.contactsService.countSegmentContacts(
        accountId,
        segmentId,
      );
      return {
        segmentId,
        count,
        message: `${count} contact(s) actif(s) dans ce segment`,
      };
    } catch (error) {
      throw new BadRequestException({
        message: 'Erreur lors du comptage',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @Get('segments/:id')
  @ApiOperation({ summary: 'Recuperer segment' })
  async getSegment(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const segment = await this.contactsService.getSegmentWithContacts(
      accountId,
      id,
    );
    if (!segment) throw new NotFoundException('Segment non trouve');
    return { segment };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Patch('segments/:id')
  @ApiOperation({ summary: 'Modifier segment' })
  async updateSegment(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      logic?: SegmentLogic;
      criteria?: SegmentCriterion[];
      type?: 'dynamic' | 'static';
      contactIds?: string[];
    },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const updated = await this.contactsService.updateSegment(
      accountId,
      id,
      body,
    );
    await this.contactsService.createAuditLog(accountId, 'segment_updated', {
      segmentId: id,
      name: updated.name,
    });

    return {
      success: true,
      segment: updated,
    };
  }

  @RequireRoles(UserRole.Admin, UserRole.Editor)
  @Delete('segments/:id')
  @ApiOperation({ summary: 'Supprimer segment' })
  async deleteSegment(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const deleted = await this.contactsService.deleteSegment(accountId, id);
    if (!deleted) throw new NotFoundException('Segment non trouve');
    await this.contactsService.createAuditLog(accountId, 'segment_deleted', {
      segmentId: id,
    });
    return { success: true };
  }
}
