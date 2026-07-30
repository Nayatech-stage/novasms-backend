import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLogsService } from './audit-logs.service';
import type { Request as ExpressRequest } from 'express';

type TenantRequest = ExpressRequest & { accountId?: string };

@ApiTags('Audit Logs')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /** US-017 — Lister les journaux d'audit du compte */
  @Get()
  @ApiOperation({ summary: "Journaux d'audit — US-017" })
  async findAll(
    @Request() req: TenantRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    return this.auditLogsService.findAll(
      String(accountId),
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      action,
    );
  }
}
