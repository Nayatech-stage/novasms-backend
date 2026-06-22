import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiHeader } from '@nestjs/swagger';
import { ApiKeyGuard, RequireApiPermission } from '../api-keys/api-key.guard';
import { ApiKeyThrottlerGuard } from '../api-keys/api-key-throttler.guard';
import { ContactsService } from '../contacts/contacts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import type { Request as ExpressRequest } from 'express';
import { calculateSendCost } from '../common/billing.util';

type ApiRequest = ExpressRequest & {
  accountId?: string;
  apiKeyId?: string;
  apiCreditsUsed?: number;
};

@ApiTags('API Publique v1')
@ApiSecurity('api-key')
@ApiHeader({
  name: 'Authorization',
  description: 'Bearer nvsms_...',
  required: true,
})
@Controller('v1')
@UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard)
export class PublicApiController {
  constructor(
    private contactsService: ContactsService,
    private prisma: PrismaService,
    private smsFactory: SmsProviderFactory,
    private emailFactory: EmailProviderFactory,
  ) {}

  // ── BALANCE ──────────────────────────────────────────────────────────────

  @Get('balance')
  @RequireApiPermission('balance:read')
  @ApiOperation({ summary: 'Consulter le solde de crédits' })
  async getBalance(@Request() req: ApiRequest) {
    const account = await this.prisma.account.findUnique({
      where: { id: req.accountId! },
      select: { creditBalance: true, alertThreshold: true },
    });
    if (!account) throw new BadRequestException('Compte introuvable');
    return {
      balance: Number(account.creditBalance),
      alertThreshold: account.alertThreshold
        ? Number(account.alertThreshold)
        : null,
      currency: 'FCFA',
    };
  }

  // ── CONTACTS ─────────────────────────────────────────────────────────────

  @Get('contacts')
  @RequireApiPermission('contacts:read')
  @ApiOperation({ summary: 'Lister les contacts (paginés)' })
  async listContacts(
    @Request() req: ApiRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
  ) {
    const parsedLimit = Math.min(parseInt(limit ?? '20', 10) || 20, 100);
    return this.contactsService.findAll(req.accountId!, {
      limit: parsedLimit,
      cursor,
      search,
    });
  }

  @Post('contacts')
  @RequireApiPermission('contacts:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un contact' })
  async createContact(
    @Request() req: ApiRequest,
    @Body()
    body: {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      location?: string;
      tags?: string[];
    },
  ) {
    if (!body.email && !body.phone)
      throw new BadRequestException('email ou phone requis');
    const contact = await this.contactsService.create(req.accountId!, body);
    return { success: true, contact };
  }

  @Get('contacts/:id')
  @RequireApiPermission('contacts:read')
  @ApiOperation({ summary: 'Récupérer un contact par ID' })
  async getContact(@Param('id') id: string, @Request() req: ApiRequest) {
    const contact = await this.contactsService.findById(req.accountId!, id);
    if (!contact) throw new NotFoundException('Contact introuvable');
    return { contact };
  }

  @Patch('contacts/:id')
  @RequireApiPermission('contacts:write')
  @ApiOperation({ summary: 'Modifier un contact' })
  async updateContact(
    @Param('id') id: string,
    @Request() req: ApiRequest,
    @Body()
    body: {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      location?: string;
      tags?: string[];
    },
  ) {
    const updated = await this.contactsService.update(req.accountId!, id, body);
    if (!updated) throw new NotFoundException('Contact introuvable');
    return { success: true, contact: updated };
  }

  @Delete('contacts/:id')
  @RequireApiPermission('contacts:write')
  @ApiOperation({ summary: 'Supprimer un contact' })
  async deleteContact(@Param('id') id: string, @Request() req: ApiRequest) {
    return this.contactsService.remove(req.accountId!, id);
  }

  // ── SMS ───────────────────────────────────────────────────────────────────

  @Post('sms')
  @RequireApiPermission('sms:send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoyer un SMS à un ou plusieurs numéros' })
  async sendSms(
    @Request() req: ApiRequest,
    @Body() body: { to: string | string[]; message: string },
  ) {
    if (!body.message?.trim()) throw new BadRequestException('message requis');
    const recipients = Array.isArray(body.to) ? body.to : [body.to];
    if (recipients.length === 0) throw new BadRequestException('to requis');
    if (recipients.length > 500)
      throw new BadRequestException('Maximum 500 destinataires par appel');

    const account = await this.prisma.account.findUnique({
      where: { id: req.accountId! },
      select: { creditBalance: true },
    });
    if (!account) throw new BadRequestException('Compte introuvable');

    const {
      total: totalCost,
      parts,
      unitPrice: costPerSms,
    } = calculateSendCost('SMS', recipients.length, body.message);
    if (Number(account.creditBalance) < totalCost) {
      throw new BadRequestException(
        `Solde insuffisant. Requis: ${totalCost} FCFA (${recipients.length} × ${parts} partie(s) × ${costPerSms} FCFA), Disponible: ${Number(account.creditBalance)} FCFA`,
      );
    }

    const provider = this.smsFactory.getProvider();
    const results: { phone: string; success: boolean; error?: string }[] = [];
    let sent = 0;

    for (const phone of recipients) {
      try {
        await provider.send(phone, body.message);
        results.push({ phone, success: true });
        sent++;
      } catch (err) {
        results.push({
          phone,
          success: false,
          error: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    }

    const creditsUsed =
      sent > 0 ? calculateSendCost('SMS', sent, body.message).total : 0;

    if (sent > 0) {
      await this.prisma.account.update({
        where: { id: req.accountId! },
        data: { creditBalance: { decrement: creditsUsed } },
      });
    }

    req.apiCreditsUsed = creditsUsed;

    return {
      success: true,
      sent,
      failed: recipients.length - sent,
      creditsUsed,
      results,
    };
  }

  // ── EMAIL ─────────────────────────────────────────────────────────────────

  @Post('email')
  @RequireApiPermission('email:send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envoyer un email transactionnel à un ou plusieurs destinataires',
  })
  async sendEmail(
    @Request() req: ApiRequest,
    @Body()
    body: {
      to: string | string[];
      subject: string;
      html: string;
      text?: string;
    },
  ) {
    if (!body.subject?.trim()) throw new BadRequestException('subject requis');
    if (!body.html?.trim()) throw new BadRequestException('html requis');

    const recipients = Array.isArray(body.to) ? body.to : [body.to];
    if (recipients.length === 0) throw new BadRequestException('to requis');
    if (recipients.length > 500)
      throw new BadRequestException('Maximum 500 destinataires par appel');

    const provider = this.emailFactory.getProvider();
    const results: {
      email: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }[] = [];
    let sent = 0;

    for (const email of recipients) {
      const result = await provider.send(email, body.subject, body.html);
      if (result.success) {
        results.push({ email, success: true, messageId: result.messageId });
        sent++;
      } else {
        results.push({ email, success: false, error: result.error });
      }
    }

    return { success: true, sent, failed: recipients.length - sent, results };
  }

  // ── CAMPAIGNS ─────────────────────────────────────────────────────────────

  @Get('campaigns')
  @RequireApiPermission('campaigns:read')
  @ApiOperation({ summary: 'Lister les campagnes' })
  async listCampaigns(
    @Request() req: ApiRequest,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Math.min(parseInt(limit ?? '20', 10) || 20, 100);
    const campaigns = await this.prisma.campaign.findMany({
      where: { accountId: req.accountId! },
      select: {
        id: true,
        name: true,
        channelType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        sentCount: true,
        estimatedRecipients: true,
      },
      orderBy: { createdAt: 'desc' },
      take: parsedLimit,
    });
    return { data: campaigns, total: campaigns.length };
  }
}
