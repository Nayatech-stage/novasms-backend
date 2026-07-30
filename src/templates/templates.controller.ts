import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import type { Request as ExpressRequest } from 'express';

type TenantRequest = ExpressRequest & { accountId?: string };

@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Post()
  create(@Body() body: CreateTemplateDto, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (accountId) body.accountId = accountId;
    return this.svc.create(body);
  }

  @Get()
  findAll(@Request() req: TenantRequest) {
    const accountId = req.accountId;
    return this.svc.findAll(undefined, undefined, accountId);
  }

  @Get('key/:key')
  findByKey(@Param('key') key: string) {
    return this.svc.findByKey(key);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateTemplateDto) {
    return this.svc.update(id, body);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: UpdateTemplateDto) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/preview')
  async preview(
    @Param('id') id: string,
    @Body() vars: Record<string, unknown>,
  ) {
    const t = await this.svc.findOne(id);
    // simple token replacement for preview
    let html = t.htmlContent || '';
    let text = t.contentText || '';
    Object.keys(vars || {}).forEach((k) => {
      const re = new RegExp(`{{\\s*${k}\\s*}}`, 'g');
      html = html.replace(re, String(vars[k] ?? ''));
      text = text.replace(re, String(vars[k] ?? ''));
    });
    return { html, text };
  }
}
