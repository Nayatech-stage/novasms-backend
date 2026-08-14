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
  Headers,
  BadRequestException,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountService } from './account.service';

interface TenantRequest extends Request {
  user: { sub: string; email: string; accountId: string; role: string };
  accountId?: string;
}

function requireAdmin(req: TenantRequest): void {
  if (req.user?.role !== UserRole.Admin) {
    throw new ForbiddenException('Accès réservé aux administrateurs');
  }
}

@ApiTags('Account')
@Controller('account')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('me')
  @ApiOperation({ summary: "Profil de l'utilisateur connecté" })
  async getMe(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const user = await this.accountService.getMe(accountId, req.user.email);
    return { success: true, user };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour son profil' })
  async updateMe(@Body() _body: { firstName?: string; lastName?: string }) {
    return { success: true, message: 'Profil mis à jour' };
  }

  @Get('profile')
  @ApiOperation({ summary: 'Profil du compte (boutique)' })
  async getProfile(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const account = await this.accountService.getProfile(accountId);
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
    const account = await this.accountService.updateProfile(accountId, body);
    return { success: true, account };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Mettre à jour les paramètres du compte' })
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
    await this.accountService.updateSettings(accountId, body);
    return { success: true };
  }

  @Get('notification-prefs')
  @ApiOperation({ summary: 'Récupérer les préférences de notification' })
  async getNotificationPrefs(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const prefs = await this.accountService.getNotificationPrefs(accountId);
    return { success: true, prefs };
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
    await this.accountService.updateNotificationPrefs(accountId, body);
    return { success: true };
  }

  @Get('team')
  @ApiOperation({ summary: "Liste des membres de l'équipe" })
  async getTeam(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const { users, invitations } = await this.accountService.getTeam(accountId);
    return { success: true, users, invitations };
  }

  @Post('team/invite')
  @ApiOperation({ summary: 'Inviter un membre' })
  async inviteMember(
    @Request() req: TenantRequest,
    @Body() body: { email: string; role: string },
  ) {
    requireAdmin(req);
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const invitation = await this.accountService.inviteMember(
      accountId,
      req.user.email,
      body,
    );
    return { success: true, invitation };
  }

  @Delete('team/:userId')
  @ApiOperation({ summary: "Révoquer l'accès d'un membre" })
  async revokeMember(
    @Request() req: TenantRequest,
    @Param('userId') userId: string,
  ) {
    requireAdmin(req);
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    await this.accountService.revokeMember(accountId, userId);
    return { success: true };
  }

  @Delete('team/invitations/:invitationId')
  @ApiOperation({ summary: 'Annuler une invitation' })
  async cancelInvitation(
    @Request() req: TenantRequest,
    @Param('invitationId') invitationId: string,
  ) {
    requireAdmin(req);
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    await this.accountService.cancelInvitation(accountId, invitationId);
    return { success: true };
  }

  @Patch('password')
  @ApiOperation({ summary: 'Changer son mot de passe' })
  async changePassword(
    @Request() req: TenantRequest,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    await this.accountService.changePassword(accountId, req.user.email, body);
    return { success: true };
  }

  @Get('balance')
  @ApiOperation({ summary: 'Solde de crédits du compte' })
  async getBalance(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const data = await this.accountService.getBalance(accountId);
    return { success: true, ...data };
  }

  @Get('export')
  @ApiOperation({ summary: 'Exporter toutes les données du compte (RGPD)' })
  async exportAccountData(@Request() req: TenantRequest, @Res() res: Response) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const exportData = await this.accountService.exportAccountData(accountId);
    const filename = `novasms-export-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  }

  @Get('credit-usage/summary')
  @ApiOperation({ summary: 'Résumé des dépenses par canal et par membre' })
  async getCreditUsageSummary(@Request() req: TenantRequest) {
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.accountService.getCreditUsageSummary(accountId, req.user.role);
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
    return this.accountService.getCreditUsageHistory(accountId, req.user.role, {
      page,
      limit,
      channel,
      source,
      userId,
      from,
      to,
    });
  }

  @Post('dev/add-credits')
  @ApiOperation({
    summary: 'Staging only — ajoute des crédits via clé interne',
  })
  async devAddCredits(
    @Body() body: { amount: number },
    @Request() req: TenantRequest,
  ) {
    const devKey = (req.headers as unknown as Record<string, string>)[
      'x-dev-key'
    ];
    const expectedKey = process.env.DEV_CREDITS_KEY || 'nova-staging-dev-2026';
    if (devKey !== expectedKey) {
      throw new ForbiddenException('Accès non autorisé');
    }
    const accountId = req.user.accountId || req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const amount = Number(body.amount);
    if (!amount || amount <= 0)
      throw new BadRequestException('Montant invalide');
    return this.accountService.devAddCredits(accountId, amount);
  }
}
