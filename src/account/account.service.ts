import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async getMe(accountId: string, email: string) {
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
    return user;
  }

  async getProfile(accountId: string) {
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
    return account;
  }

  async updateProfile(
    accountId: string,
    body: { companyName?: string; country?: string },
  ) {
    const data: Record<string, unknown> = {};
    if (body.companyName?.trim()) data['companyName'] = body.companyName.trim();
    if (body.country?.trim()) data['country'] = body.country.trim();

    return this.prisma.account.update({
      where: { id: accountId },
      data,
      select: { id: true, companyName: true, country: true },
    });
  }

  async updateSettings(
    accountId: string,
    body: {
      alertThreshold?: number;
      creditLimit?: number;
      language?: string;
      timezone?: string;
    },
  ) {
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
  }

  async getNotificationPrefs(accountId: string) {
    const prefs = await this.prisma.notificationPrefs.findUnique({
      where: { accountId },
    });
    return (
      prefs ?? {
        emailOnCampaignDone: true,
        emailOnLowCredits: true,
        emailOnTeamInvite: true,
        smsOnCampaignDone: false,
        smsOnLowCredits: true,
        weeklyReportEmail: true,
        automationAlertsEmail: true,
      }
    );
  }

  async updateNotificationPrefs(
    accountId: string,
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
  }

  async getTeam(accountId: string) {
    const [users, invitations] = await Promise.all([
      this.prisma.user.findMany({
        where: { accountId },
        select: {
          id: true,
          email: true,
          role: true,
          lastLogin: true,
          firstName: true,
          lastName: true,
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
    return { users, invitations };
  }

  async inviteMember(
    accountId: string,
    inviterEmail: string,
    body: { email: string; role: string },
  ) {
    if (!body.email?.trim()) throw new BadRequestException('Email requis');

    const validRoles: UserRole[] = [
      UserRole.Admin,
      UserRole.Editor,
      UserRole.Analyst,
    ];
    const role = validRoles.includes(body.role as UserRole)
      ? (body.role as UserRole)
      : UserRole.Editor;

    const existing = await this.prisma.user.findFirst({
      where: { email: body.email.trim(), accountId },
    });
    if (existing)
      throw new BadRequestException("Cet email fait déjà partie de l'équipe");

    const pendingInvite = await this.prisma.invitation.findFirst({
      where: {
        email: body.email.trim(),
        accountId,
        status: 'Sent',
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingInvite)
      throw new BadRequestException(
        'Une invitation est déjà en attente pour cet email',
      );

    const token = randomUUID();
    const invitation = await this.prisma.invitation.create({
      data: {
        accountId,
        email: body.email.trim(),
        role,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'Sent',
      },
    });

    try {
      await this.mail.sendInvitationEmail(
        invitation.email,
        token,
        inviterEmail,
      );
    } catch (mailError) {
      // Si l'envoi échoue, supprimer l'invitation pour éviter un fantôme en DB
      await this.prisma.invitation.delete({ where: { id: invitation.id } });
      throw new BadRequestException(
        `Invitation créée mais email non envoyé : ${(mailError as Error).message}`,
      );
    }
    return invitation;
  }

  async revokeMember(accountId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, accountId },
    });
    if (!user) throw new NotFoundException('Membre introuvable');
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async cancelInvitation(accountId: string, invitationId: string) {
    const inv = await this.prisma.invitation.findFirst({
      where: { id: invitationId, accountId },
    });
    if (!inv) throw new NotFoundException('Invitation introuvable');
    await this.prisma.invitation.delete({ where: { id: invitationId } });
  }

  async changePassword(
    accountId: string,
    email: string,
    body: { currentPassword: string; newPassword: string },
  ) {
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
  }

  async getBalance(accountId: string) {
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
      balance: Number(account.creditBalance),
      alertThreshold: account.alertThreshold
        ? Number(account.alertThreshold)
        : null,
      creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
      language: account.language ?? 'fr',
      timezone: account.timezone ?? 'Africa/Abidjan',
    };
  }

  async exportAccountData(accountId: string) {
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

    return {
      exportedAt: new Date().toISOString(),
      account,
      contacts,
      campaigns,
    };
  }

  async getCreditUsageSummary(accountId: string, userRole: string) {
    if (userRole !== UserRole.Admin)
      throw new ForbiddenException('Réservé aux administrateurs');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const monthFilter = { accountId, createdAt: { gte: startOfMonth } };

    const [byChannel, bySource, byMember, monthTotal, yearTotal, allTimeTotal] =
      await Promise.all([
        this.prisma.creditUsage.groupBy({
          by: ['channel'],
          where: monthFilter,
          _sum: { totalCost: true, contacts: true },
          _count: { id: true },
        }),
        this.prisma.creditUsage.groupBy({
          by: ['source'],
          where: monthFilter,
          _sum: { totalCost: true },
          _count: { id: true },
        }),
        this.prisma.creditUsage.groupBy({
          by: ['userId'],
          where: { ...monthFilter, userId: { not: null } },
          _sum: { totalCost: true },
          _count: { id: true },
          orderBy: { _sum: { totalCost: 'desc' } },
        }),
        this.prisma.creditUsage.aggregate({
          where: monthFilter,
          _sum: { totalCost: true },
        }),
        this.prisma.creditUsage.aggregate({
          where: { accountId, createdAt: { gte: startOfYear } },
          _sum: { totalCost: true },
        }),
        this.prisma.creditUsage.aggregate({
          where: { accountId },
          _sum: { totalCost: true },
        }),
      ]);

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
      yearTotal: Number(yearTotal._sum.totalCost ?? 0),
      allTimeTotal: Number(allTimeTotal._sum.totalCost ?? 0),
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

  async getCreditUsageHistory(
    accountId: string,
    userRole: string,
    filters: {
      page: string;
      limit: string;
      channel?: string;
      source?: string;
      userId?: string;
      from?: string;
      to?: string;
    },
  ) {
    if (userRole !== UserRole.Admin)
      throw new ForbiddenException('Réservé aux administrateurs');

    const pageNum = Math.max(1, parseInt(filters.page));
    const limitNum = Math.min(100, Math.max(1, parseInt(filters.limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      accountId,
      ...(filters.channel ? { channel: filters.channel.toUpperCase() } : {}),
      ...(filters.source ? { source: filters.source.toUpperCase() } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
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

  async devAddCredits(accountId: string, amount: number) {
    const updated = await this.prisma.account.update({
      where: { id: accountId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true },
    });
    return {
      success: true,
      message: `${amount} FCFA ajoutés au compte de staging`,
      newBalance: Number(updated.creditBalance),
    };
  }
}
