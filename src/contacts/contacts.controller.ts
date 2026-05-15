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
import { ContactsService } from './contacts.service';
import { ImportService } from './import.service';
import { SegmentCreateSchema, SegmentPreviewSchema } from './dto/segment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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
@UseGuards(JwtAuthGuard)
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

    const result = await this.importService.processFullImport(
      accountId,
      body.fileName,
      mappedRows,
    );
    return {
      success: true,
      jobId: result.jobId,
      status: result.status,
      report: result.report,
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

  @Post()
  @ApiOperation({ summary: 'Creer un contact' })
  async create(@Body() body: ContactUpdateBody, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.contactsService.create(accountId, body);
  }

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

  @Get('segments/:id')
  @ApiOperation({ summary: 'Recuperer segment' })
  async getSegment(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const segments = await this.contactsService.listSegments(accountId);
    const segment = segments.find((s: any) => s.id === id);
    if (!segment) throw new NotFoundException('Segment non trouve');
    return { segment };
  }

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
