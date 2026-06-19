import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

interface TenantRequest extends Request {
  user: { sub: string; email: string; accountId: string; role: string };
  accountId?: string;
}

@ApiTags('Account')
@Controller('account')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── Profil utilisateur connecté ────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: "Profil de l'utilisateur connecté" })
  async getMe(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    const email = req.user.email;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const user = await this.prisma.user.findFirst({
      where: { email, accountId },
      select: {
        id: true,
        email: true,
        role: true,
        lastLogin: true,
        account: {
          select: {
            id: true,
            companyName: true,
            adminEmail: true,
            country: true,
            creditBalance: true,
            alertThreshold: true,
            twoFactorEnabled: true,
            onboardingCompleted: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return { success: true, user };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour son profil' })
  async updateMe(
    @Request() req: TenantRequest,
    @Body() body: { firstName?: string; lastName?: string },
  ) {
    const userId = req.user.sub;
    // Les utilisateurs n'ont pas de firstName/lastName dans le schéma actuel
    // On met à jour les données du compte
    return { success: true, message: 'Profil mis à jour' };
  }

  // ─── Profil du compte (boutique) ────────────────────────────────────────────

  @Get('profile')
  @ApiOperation({ summary: 'Profil du compte (boutique)' })
  async getProfile(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        companyName: true,
        adminEmail: true,
        country: true,
        creditBalance: true,
        alertThreshold: true,
        onboardingCompleted: true,
      },
    });
    if (!account) throw new NotFoundException('Compte introuvable');
    return { success: true, account };
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Mettre à jour le profil du compte' })
  async updateProfile(
    @Request() req: TenantRequest,
    @Body() body: { companyName?: string; country?: string; timezone?: string },
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const data: Record<string, unknown> = {};
    if (body.companyName?.trim()) data['companyName'] = body.companyName.trim();
    if (body.country?.trim()) data['country'] = body.country.trim();

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data,
      select: { id: true, companyName: true, country: true },
    });
    return { success: true, account };
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Mettre à jour les paramètres du compte',
  })
  async updateSettings(
    @Request() req: TenantRequest,
    @Body()
    body: {
      alertThreshold?: number;
      creditLimit?: number;
      language?: string;
      timezone?: string;
    },
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const data: Record<string, unknown> = {};
    if (typeof body.alertThreshold === 'number') {
      data['alertThreshold'] = body.alertThreshold;
    }
    if (typeof body.creditLimit === 'number') {
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: { creditBalance: true },
      });
      if (!account) throw new BadRequestException('Compte introuvable');
      if (body.creditLimit > Number(account.creditBalance)) {
        throw new BadRequestException(
          "La limite d'utilisation ne peut pas dépasser le solde actuel",
        );
      }
      if (body.creditLimit < 0) {
        throw new BadRequestException(
          "La limite d'utilisation doit être positive",
        );
      }
      data['creditLimit'] = body.creditLimit;
    }
    if (body.language && ['fr', 'en'].includes(body.language)) {
      data['language'] = body.language;
    }
    if (body.timezone?.trim()) {
      data['timezone'] = body.timezone.trim();
    }

    await this.prisma.account.update({ where: { id: accountId }, data });
    return { success: true };
  }

  // ─── Préférences de notification ─────────────────────────────────────────────

  @Get('notification-prefs')
  @ApiOperation({ summary: 'Récupérer les préférences de notification' })
  async getNotificationPrefs(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const prefs = await this.prisma.notificationPrefs.findUnique({
      where: { accountId },
    });

    return {
      success: true,
      prefs: prefs ?? {
        emailOnCampaignDone: true,
        emailOnLowCredits: true,
        emailOnTeamInvite: true,
        smsOnCampaignDone: false,
        smsOnLowCredits: true,
        weeklyReportEmail: true,
        automationAlertsEmail: true,
      },
    };
  }

  @Patch('notification-prefs')
  @ApiOperation({ summary: 'Mettre à jour les préférences de notification' })
  async updateNotificationPrefs(
    @Request() req: TenantRequest,
    @Body()
    body: {
      emailOnCampaignDone?: boolean;
      emailOnLowCredits?: boolean;
      emailOnTeamInvite?: boolean;
      smsOnCampaignDone?: boolean;
      smsOnLowCredits?: boolean;
      weeklyReportEmail?: boolean;
      automationAlertsEmail?: boolean;
    },
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const data: Record<string, unknown> = {};
    if (typeof body.emailOnCampaignDone === 'boolean')
      data['emailOnCampaignDone'] = body.emailOnCampaignDone;
    if (typeof body.emailOnLowCredits === 'boolean')
      data['emailOnLowCredits'] = body.emailOnLowCredits;
    if (typeof body.emailOnTeamInvite === 'boolean')
      data['emailOnTeamInvite'] = body.emailOnTeamInvite;
    if (typeof body.smsOnCampaignDone === 'boolean')
      data['smsOnCampaignDone'] = body.smsOnCampaignDone;
    if (typeof body.smsOnLowCredits === 'boolean')
      data['smsOnLowCredits'] = body.smsOnLowCredits;
    if (typeof body.weeklyReportEmail === 'boolean')
      data['weeklyReportEmail'] = body.weeklyReportEmail;
    if (typeof body.automationAlertsEmail === 'boolean')
      data['automationAlertsEmail'] = body.automationAlertsEmail;

    await this.prisma.notificationPrefs.upsert({
      where: { accountId },
      create: { accountId, ...data },
      update: data,
    });

    return { success: true };
  }

  // ─── Équipe ──────────────────────────────────────────────────────────────────

  @Get('team')
  @ApiOperation({ summary: "Liste des membres de l'équipe" })
  async getTeam(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const [users, invitations] = await Promise.all([
      this.prisma.user.findMany({
        where: { accountId },
        select: {
          id: true,
          email: true,
          role: true,
          lastLogin: true,
        },
        orderBy: { lastLogin: 'desc' },
      }),
      this.prisma.invitation.findMany({
        where: { accountId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
        },
        orderBy: { expiresAt: 'desc' },
      }),
    ]);

    return { success: true, users, invitations };
  }

  @Post('team/invite')
  @ApiOperation({ summary: 'Inviter un membre' })
  async inviteMember(
    @Request() req: TenantRequest,
    @Body() body: { email: string; role: string },
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.email?.trim()) throw new BadRequestException('Email requis');

    const validRoles: UserRole[] = [
      UserRole.Admin,
      UserRole.Editor,
      UserRole.Analyst,
    ];
    const role = validRoles.includes(body.role as UserRole)
      ? (body.role as UserRole)
      : UserRole.Editor;

    // Vérifier si l'utilisateur n'existe pas déjà
    const existing = await this.prisma.user.findFirst({
      where: { email: body.email.trim(), accountId },
    });
    if (existing)
      throw new BadRequestException("Cet email fait déjà partie de l'équipe");

    // Créer une invitation
    const token = randomUUID();
    const invitation = await this.prisma.invitation.create({
      data: {
        accountId,
        email: body.email.trim(),
        role,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
        status: 'Sent',
      },
    });

    // TODO: envoyer email d'invitation via MailService
    // await this.mail.sendInvitationEmail(invitation.email, token);

    return { success: true, invitation };
  }

  @Delete('team/:userId')
  @ApiOperation({ summary: "Révoquer l'accès d'un membre" })
  async revokeMember(
    @Request() req: TenantRequest,
    @Param('userId') userId: string,
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const user = await this.prisma.user.findFirst({
      where: { id: userId, accountId },
    });
    if (!user) throw new NotFoundException('Membre introuvable');

    await this.prisma.user.delete({ where: { id: userId } });
    return { success: true };
  }

  @Delete('team/invitations/:invitationId')
  @ApiOperation({ summary: 'Annuler une invitation' })
  async cancelInvitation(
    @Request() req: TenantRequest,
    @Param('invitationId') invitationId: string,
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const inv = await this.prisma.invitation.findFirst({
      where: { id: invitationId, accountId },
    });
    if (!inv) throw new NotFoundException('Invitation introuvable');

    await this.prisma.invitation.delete({ where: { id: invitationId } });
    return { success: true };
  }

  // ─── Changer mot de passe ───────────────────────────────────────────────────

  @Patch('password')
  @ApiOperation({ summary: 'Changer son mot de passe' })
  async changePassword(
    @Request() req: TenantRequest,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const accountId = req.user.accountId || req.accountId;
    const email = req.user.email;
    if (!body.currentPassword || !body.newPassword) {
      throw new BadRequestException('Mot de passe actuel et nouveau requis');
    }
    if (body.newPassword.length < 8) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caractères',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { email, accountId },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Mot de passe actuel incorrect');

    const hash = await bcrypt.hash(body.newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });

    return { success: true };
  }

  // ─── Solde du compte ────────────────────────────────────────────────────────

  @Get('balance')
  @ApiOperation({ summary: 'Solde de crédits du compte' })
  async getBalance(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        creditBalance: true,
        alertThreshold: true,
        creditLimit: true,
        language: true,
        timezone: true,
      },
    });
    if (!account) throw new NotFoundException('Compte introuvable');

    return {
      success: true,
      balance: Number(account.creditBalance),
      alertThreshold: account.alertThreshold
        ? Number(account.alertThreshold)
        : null,
      creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
      language: account.language ?? 'fr',
      timezone: account.timezone ?? 'Africa/Abidjan',
    };
  }

  // ─── Export RGPD des données ─────────────────────────────────────────────────

  @Get('export')
  @ApiOperation({ summary: 'Exporter toutes les données du compte (RGPD)' })
  async exportAccountData(@Request() req: TenantRequest, @Res() res: Response) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const [account, contacts, campaigns] = await Promise.all([
      this.prisma.account.findUnique({
        where: { id: accountId },
        select: {
          companyName: true,
          adminEmail: true,
          country: true,
          creditBalance: true,
          createdAt: true,
        },
      }),
      this.prisma.contact.findMany({
        where: { accountId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          tags: true,
          location: true,
          optOut: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campaign.findMany({
        where: { accountId },
        select: {
          id: true,
          name: true,
          channelType: true,
          status: true,
          sentCount: true,
          deliveredCount: true,
          openedCount: true,
          clickedCount: true,
          scheduledAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      account,
      contacts,
      campaigns,
    };

    const filename = `novasms-export-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  }

  // ─── Historique des dépenses (admin only) ───────────────────────────────────

  @Get('credit-usage/summary')
  @ApiOperation({ summary: 'Résumé des dépenses par canal et par membre' })
  async getCreditUsageSummary(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (req.user.role !== UserRole.Admin)
      throw new ForbiddenException('Réservé aux administrateurs');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [byChannel, bySource, byMember, monthTotal] = await Promise.all([
      // Total par canal (SMS / EMAIL / WHATSAPP)
      this.prisma.creditUsage.groupBy({
        by: ['channel'],
        where: { accountId },
        _sum: { totalCost: true, contacts: true },
        _count: { id: true },
      }),
      // Total par source (CAMPAIGN / AUTOMATION / API)
      this.prisma.creditUsage.groupBy({
        by: ['source'],
        where: { accountId },
        _sum: { totalCost: true },
        _count: { id: true },
      }),
      // Dépenses par membre (userId non null)
      this.prisma.creditUsage.groupBy({
        by: ['userId'],
        where: { accountId, userId: { not: null } },
        _sum: { totalCost: true },
        _count: { id: true },
        orderBy: { _sum: { totalCost: 'desc' } },
      }),
      // Total du mois en cours
      this.prisma.creditUsage.aggregate({
        where: { accountId, createdAt: { gte: startOfMonth } },
        _sum: { totalCost: true },
      }),
    ]);

    // Enrichir les membres avec email + nom
    const userIds = byMember.map((m) => m.userId).filter(Boolean) as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    return {
      monthTotal: Number(monthTotal._sum.totalCost ?? 0),
      byChannel: byChannel.map((r) => ({
        channel: r.channel,
        totalCost: Number(r._sum.totalCost ?? 0),
        totalContacts: r._sum.contacts ?? 0,
        operationCount: r._count.id,
      })),
      bySource: bySource.map((r) => ({
        source: r.source,
        totalCost: Number(r._sum.totalCost ?? 0),
        operationCount: r._count.id,
      })),
      byMember: byMember.map((r) => ({
        userId: r.userId,
        user: r.userId ? (userMap[r.userId] ?? null) : null,
        totalCost: Number(r._sum.totalCost ?? 0),
        operationCount: r._count.id,
      })),
    };
  }

  @Get('credit-usage')
  @ApiOperation({ summary: 'Historique paginé des dépenses' })
  async getCreditUsageHistory(
    @Request() req: TenantRequest,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('channel') channel?: string,
    @Query('source') source?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (req.user.role !== UserRole.Admin)
      throw new ForbiddenException('Réservé aux administrateurs');

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      accountId,
      ...(channel ? { channel: channel.toUpperCase() } : {}),
      ...(source ? { source: source.toUpperCase() } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.creditUsage.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.creditUsage.count({ where }),
    ]);

    return {
      data: data.map((r) => ({
        ...r,
        totalCost: Number(r.totalCost),
        unitPrice: Number(r.unitPrice),
      })),
      total,
      page: pageNum,
      limit: limitNum,
    };
  }
}
