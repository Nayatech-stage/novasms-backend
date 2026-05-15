import { Body, Controller, Post, Request, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

type TenantRequest = ExpressRequest & { accountId?: string };

@ApiTags('Campaigns')
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Post()
  async create(@Body() body: unknown, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.campaignsService.create(
      accountId,
      body as Record<string, unknown>,
    );
  }

  @Get()
  async list(@Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return { data: await this.campaignsService.list(accountId) };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.campaignsService.get(accountId, id);
  }
}
