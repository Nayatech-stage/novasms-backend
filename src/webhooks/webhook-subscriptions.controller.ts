import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { Request as ExpressRequest } from 'express';
import { randomBytes } from 'crypto';

type TenantRequest = ExpressRequest & { accountId?: string };

const ALLOWED_EVENTS = [
  'campaign.sent',
  'campaign.failed',
  'contact.created',
  'contact.updated',
  'contact.unsubscribed',
  'sms.sent',
  'sms.failed',
  'email.sent',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'payment.completed',
  'automation.triggered',
];

@ApiTags('Webhooks CRUD')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhookSubscriptionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.prisma.webhookSubscription.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(
    @Request() req: TenantRequest,
    @Body()
    body: {
      url: string;
      events: string[];
      description?: string;
      generateSecret?: boolean;
    },
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.url || !body.url.startsWith('http'))
      throw new BadRequestException(
        'URL invalide (doit commencer par http/https)',
      );
    if (!Array.isArray(body.events) || body.events.length === 0)
      throw new BadRequestException('Au moins un événement est requis');

    const invalidEvents = body.events.filter(
      (e) => !ALLOWED_EVENTS.includes(e),
    );
    if (invalidEvents.length > 0)
      throw new BadRequestException(
        `Événements non reconnus : ${invalidEvents.join(', ')}. Valeurs acceptées : ${ALLOWED_EVENTS.join(', ')}`,
      );

    const secret = body.generateSecret
      ? randomBytes(32).toString('hex')
      : undefined;

    const sub = await this.prisma.webhookSubscription.create({
      data: {
        accountId,
        url: body.url,
        events: body.events,
        description: body.description,
        secret,
        isActive: true,
      },
    });

    return { ...sub, secret: secret ?? null };
  }

  @Get('events')
  listAllowedEvents() {
    return { events: ALLOWED_EVENTS };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, accountId },
    });
    if (!sub) throw new NotFoundException('Webhook introuvable');
    return sub;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: TenantRequest,
    @Body()
    body: {
      url?: string;
      events?: string[];
      description?: string;
      isActive?: boolean;
    },
  ) {
    const accountId = req.accountId;
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, accountId },
    });
    if (!sub) throw new NotFoundException('Webhook introuvable');

    if (body.events) {
      const invalidEvents = body.events.filter(
        (e) => !ALLOWED_EVENTS.includes(e),
      );
      if (invalidEvents.length > 0)
        throw new BadRequestException(
          `Événements non reconnus : ${invalidEvents.join(', ')}`,
        );
    }

    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(body.url && { url: body.url }),
        ...(body.events && { events: body.events }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, accountId },
    });
    if (!sub) throw new NotFoundException('Webhook introuvable');
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { success: true };
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async sendTestPing(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, accountId },
    });
    if (!sub) throw new NotFoundException('Webhook introuvable');

    const payload = {
      event: 'ping',
      webhookId: sub.id,
      timestamp: new Date().toISOString(),
      message: 'NovaSMS webhook test ping',
    };

    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NovaSMS-Event': 'ping',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      return { success: res.ok, statusCode: res.status, payload };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        payload,
      };
    }
  }
}
