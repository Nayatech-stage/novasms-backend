import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, CampaignVariant, CampaignStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asOptionalDecimal(value: unknown): Prisma.Decimal | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  try {
    return new Prisma.Decimal(value);
  } catch {
    return undefined;
  }
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('campaign-dispatch') private dispatchQueue: Queue,
    @InjectQueue('campaign-schedule') private scheduleQueue: Queue,
  ) {}

  async create(accountId: string, data: unknown) {
    const body = asRecord(data);
    if (!body) throw new BadRequestException('Payload invalide');

    const channelType = asOptionalString(body.channelType);
    const status = asOptionalString(body.status);
    if (!channelType) throw new BadRequestException('channelType est requis');
    if (!status) throw new BadRequestException('status est requis');

    const scheduledAt = asOptionalDate(body.scheduledAt);
    const normalizedStatus = status.toLowerCase();
    const finalStatus = scheduledAt
      ? CampaignStatus.SCHEDULED
      : (normalizedStatus as CampaignStatus);

    if (!scheduledAt && normalizedStatus === 'scheduled') {
      throw new BadRequestException(
        'scheduledAt est requis pour une campagne planifiee',
      );
    }

    let contentJson: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue =
      Prisma.JsonNull;
    if (body.contentJson && typeof body.contentJson === 'string') {
      try {
        contentJson = JSON.parse(body.contentJson) as Prisma.InputJsonValue;
      } catch {
        /* ignore */
      }
    }

    // Correction bestSendTime: utiliser Prisma.JsonNull si null/undefined
    const bestSendTimeValue:
      | Prisma.NullableJsonNullValueInput
      | Prisma.InputJsonValue =
      body.bestSendTime && typeof body.bestSendTime === 'object'
        ? (JSON.parse(
            JSON.stringify(body.bestSendTime),
          ) as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    const payload: Prisma.CampaignUncheckedCreateInput = {
      accountId,
      channelType,
      status: finalStatus,
      name: asOptionalString(body.name) ?? 'Campagne',
      subject: asOptionalString(body.subject),
      subjectA: asOptionalString(body.subjectA),
      subjectB: asOptionalString(body.subjectB),
      content: asOptionalString(body.content),
      contentJson,
      abSplitPct: typeof body.abSplitPct === 'number' ? body.abSplitPct : 50,
      abTestDuration:
        typeof body.abTestDuration === 'number' ? body.abTestDuration : 4,
      segmentId: asOptionalString(body.segmentId),
      scheduledAt,
      timezone: asOptionalString(body.timezone) ?? 'Africa/Abidjan',
      estimatedCost: asOptionalDecimal(body.estimatedCost),
      bestSendTime: bestSendTimeValue,
    };

    const campaign = await this.prisma.campaign.create({ data: payload });

    if (scheduledAt) {
      const now = Date.now();
      const delayMs = scheduledAt.getTime() - now;

      const job = await this.prisma.job.create({
        data: {
          accountId,
          type: 'campaign-send',
          status: delayMs > 0 ? 'Pending' : 'Done',
        },
      });

      try {
        await this.scheduleQueue.add(
          'trigger-campaign',
          {
            campaignId: campaign.id,
            accountId,
            channelType,
          },
          {
            delay: Math.max(0, delayMs),
            jobId: `sched-${campaign.id}`,
            removeOnComplete: true,
          },
        );
      } catch (error) {
        this.logger.warn(
          `Campaign ${campaign.id} scheduled in DB but queue enqueue failed: ${String(error)}`,
        );
        await this.prisma.job.update({
          where: { id: job.id },
          data: { status: 'Failed', finishedAt: new Date() },
        });
      }
    }

    return campaign;
  }

  async list(accountId: string) {
    return this.prisma.campaign.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { segment: { select: { name: true } } },
    });
  }

  async get(accountId: string, id: string) {
    return this.prisma.campaign.findFirst({
      where: { accountId, id },
      include: {
        sends: {
          select: {
            variant: true,
            status: true,
            openedAt: true,
            clickedAt: true,
          },
        },
        abResults: true,
      },
    });
  }

  async cancelScheduled(accountId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, accountId },
    });
    if (!campaign) throw new BadRequestException('Campagne introuvable');
    if (!campaign.scheduledAt)
      throw new BadRequestException('Campagne non planifiee');

    const now = Date.now();
    const diffMs = campaign.scheduledAt.getTime() - now;
    const minCancelableDelayMs = 5 * 60 * 1000;
    if (diffMs < minCancelableDelayMs) {
      throw new BadRequestException(
        "Annulation impossible a moins de 5 minutes de l'envoi",
      );
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.CANCELLED },
    });

    try {
      await this.scheduleQueue.remove(`sched-${campaign.id}`);
    } catch (error) {
      this.logger.warn(
        `Failed to remove campaign queue job ${campaign.id}: ${String(error)}`,
      );
    }

    return { success: true, id: campaign.id, status: 'cancelled' };
  }

  async updateABConfig(
    accountId: string,
    id: string,
    data: { subjectA: string; subjectB: string; abSplitPct: number },
  ) {
    return this.prisma.campaign.update({
      where: { id, accountId },
      data: {
        subjectA: data.subjectA,
        subjectB: data.subjectB,
        abSplitPct: data.abSplitPct,
      },
    });
  }

  async evaluateABWinner(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { sends: true },
    });

    if (!campaign || !campaign.subjectB) {
      throw new BadRequestException('Campagne non éligible A/B');
    }

    const statsA = campaign.sends.filter((s) => s.variant === 'A');
    const statsB = campaign.sends.filter((s) => s.variant === 'B');

    const openRateA =
      statsA.length > 0
        ? statsA.filter((s) => s.openedAt).length / statsA.length
        : 0;
    const openRateB =
      statsB.length > 0
        ? statsB.filter((s) => s.openedAt).length / statsB.length
        : 0;

    const winner: CampaignVariant = openRateB > openRateA ? 'B' : 'A';

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { abWinner: winner },
    });

    await this.prisma.aBTestResult.upsert({
      where: { campaignId_variant: { campaignId, variant: 'A' } },
      update: {
        openedCount: { increment: statsA.filter((s) => s.openedAt).length },
      },
      create: {
        campaignId,
        variant: 'A',
        openedCount: statsA.filter((s) => s.openedAt).length,
      },
    });
    await this.prisma.aBTestResult.upsert({
      where: { campaignId_variant: { campaignId, variant: 'B' } },
      update: {
        openedCount: { increment: statsB.filter((s) => s.openedAt).length },
      },
      create: {
        campaignId,
        variant: 'B',
        openedCount: statsB.filter((s) => s.openedAt).length,
      },
    });

    await this.dispatchQueue.add(
      'dispatch-winner',
      {
        campaignId,
        variant: winner,
        remainingContacts: true,
      },
      { removeOnComplete: true },
    );

    return { winner, openRateA, openRateB, campaignId };
  }

  async getBestSendTime(accountId: string) {
    // Correction: occurredAt -> createdAt
    const engagements = await this.prisma.analytic.findMany({
      where: {
        contact: { accountId },
        action: { in: ['Open', 'Click'] },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { createdAt: true, action: true },
      take: 1000,
    });

    if (engagements.length < 10) {
      return {
        recommendedDay: 2,
        recommendedHour: 10,
        confidence: 60,
        reason: 'Recommandation basée sur les meilleures pratiques',
        timezone: 'Africa/Abidjan',
      };
    }

    const heatMap = new Map<string, number>();
    for (const e of engagements) {
      // Correction: occurredAt -> createdAt
      if (!e.createdAt) continue;
      const date = new Date(e.createdAt);
      const key = `${date.getDay()}-${date.getHours()}`;
      heatMap.set(
        key,
        (heatMap.get(key) || 0) + (e.action === 'Click' ? 2 : 1),
      );
    }

    let bestKey = '',
      bestScore = 0;
    for (const [key, score] of heatMap.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    const [day, hour] = bestKey.split('-').map(Number);
    // Correction: occurredAt -> createdAt
    const total = engagements.filter((e) => e.createdAt).length;

    return {
      recommendedDay: day,
      recommendedHour: hour,
      confidence: Math.min(95, Math.round((total / 100) * 100)),
      basedOn: total,
      timezone: 'Africa/Abidjan',
      reason: `Historiquement, votre audience engage le plus le jour ${day} à ${hour}h`,
    };
  }

  calculateSmsCost(
    text: string,
    recipientCount: number,
  ): { parts: number; cost: number } {
    // eslint-disable-next-line no-control-regex
    const GSM7_REGEX = /^[\w\s@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΣΘΞ\x00-\x7F]+$/;
    const isGsm7 = GSM7_REGEX.test(text);
    const chunkSize = isGsm7 ? 160 : 70;
    const length = text.length;
    const parts = Math.ceil(length / chunkSize) || 1;
    const costPerSms = 0.015;
    return { parts, cost: parts * recipientCount * costPerSms };
  }

  /**
   * Envoyer la campagne à tous les contacts du segment
   */
  async sendCampaign(
    accountId: string,
    campaignId: string,
    options: {
      immediateOrScheduled?: 'immediate' | 'scheduled';
      scheduledAt?: Date;
    },
  ) {
    try {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: campaignId, accountId },
        include: { segment: true },
      });

      if (!campaign) {
        return { success: false, error: 'Campagne non trouvée' };
      }

      if (!campaign.segmentId) {
        return { success: false, error: 'Segment non sélectionné' };
      }

      // Récupérer les vrais contacts du segment
      const contacts = await this.prisma.contact.findMany({
        where: {
          accountId,
          optOut: false,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
        },
      });

      if (contacts.length === 0) {
        return {
          success: false,
          error: 'Aucun contact à envoyer dans ce segment',
        };
      }

      let finalStatus: CampaignStatus = CampaignStatus.SENT;
      let finalScheduledAt: Date | null = null;

      if (
        options?.immediateOrScheduled === 'scheduled' &&
        options?.scheduledAt
      ) {
        finalStatus = CampaignStatus.SCHEDULED;
        finalScheduledAt = options.scheduledAt;
      }

      // Créer un Send record pour chaque contact
      const sendRecords = contacts.map((contact) => ({
        campaignId,
        contactId: contact.id,
        status: 'PENDING' as const,
        variant:
          campaign.subjectB && Math.random() < (campaign.abSplitPct || 50) / 100
            ? ('B' as const)
            : ('A' as const),
        email: contact.email || undefined,
        phone: contact.phone || undefined,
        firstName: contact.firstName || undefined,
        lastName: contact.lastName || undefined,
      }));

      await this.prisma.send.createMany({ data: sendRecords });

      // Mettre à jour la campagne
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: finalStatus,
          scheduledAt: finalScheduledAt,
          sentCount: contacts.length,
        },
      });

      // Ajouter les jobs d'envoi à la queue
      if (options?.immediateOrScheduled === 'scheduled' && finalScheduledAt) {
        const delayMs = finalScheduledAt.getTime() - Date.now();
        await this.scheduleQueue.add(
          'trigger-campaign',
          { campaignId, accountId, channelType: campaign.channelType },
          { delay: Math.max(0, delayMs), jobId: `sched-${campaignId}` },
        );
      } else {
        // Envoi immédiat
        await this.dispatchQueue.add(
          'dispatch-campaign',
          {
            campaignId,
            accountId,
            channelType: campaign.channelType,
            contactIds: contacts.map((c) => c.id),
          },
          { removeOnComplete: true },
        );
      }

      return {
        success: true,
        campaignId,
        contactCount: contacts.length,
        message: `Campagne prête à être envoyée à ${contacts.length} contact(s)`,
      };
    } catch (error) {
      this.logger.error(`Error sending campaign: ${String(error)}`);
      return {
        success: false,
        error: "Une erreur s'est produite. Veuillez réessayer.",
      };
    }
  }

  /**
   * Sauvegarder la campagne comme brouillon
   */
  async saveDraft(accountId: string, campaignId: string, data: unknown) {
    try {
      const body = asRecord(data);
      if (!body) {
        return { success: false, error: 'Données invalides' };
      }

      const updateData: Prisma.CampaignUpdateInput = {
        status: CampaignStatus.DRAFT,
        updatedAt: new Date(),
      };

      if (body.name !== undefined)
        updateData.name = asOptionalString(body.name);
      if (body.subject !== undefined)
        updateData.subject = asOptionalString(body.subject);
      if (body.subjectA !== undefined)
        updateData.subjectA = asOptionalString(body.subjectA);
      if (body.subjectB !== undefined)
        updateData.subjectB = asOptionalString(body.subjectB);
      if (body.content !== undefined)
        updateData.content = asOptionalString(body.content);
      if (body.contentJson !== undefined) {
        try {
          updateData.contentJson =
            typeof body.contentJson === 'string'
              ? (JSON.parse(body.contentJson) as Prisma.InputJsonValue)
              : (body.contentJson as Prisma.InputJsonValue);
        } catch {
          updateData.contentJson = body.contentJson as Prisma.InputJsonValue;
        }
      }
      if (body.segmentId !== undefined)
        updateData.segment = body.segmentId
          ? { connect: { id: asOptionalString(body.segmentId) } }
          : { disconnect: true };
      if (body.abSplitPct !== undefined)
        updateData.abSplitPct =
          typeof body.abSplitPct === 'number' ? body.abSplitPct : 50;
      if (body.timezone !== undefined)
        updateData.timezone = asOptionalString(body.timezone);

      const updated = await this.prisma.campaign.update({
        where: { id: campaignId, accountId },
        data: updateData,
      });

      return updated;
    } catch (error) {
      this.logger.error(`Error saving draft: ${String(error)}`);
      throw new BadRequestException(
        'Erreur lors de la sauvegarde du brouillon',
      );
    }
  }

  /**
   * Annuler une campagne (DRAFT ou SCHEDULED seulement)
   */
  async cancelCampaign(accountId: string, campaignId: string) {
    try {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: campaignId, accountId },
      });

      if (!campaign) {
        throw new BadRequestException('Campagne non trouvée');
      }

      if (
        campaign.status !== CampaignStatus.DRAFT &&
        campaign.status !== CampaignStatus.SCHEDULED
      ) {
        throw new BadRequestException(
          `Impossible d'annuler une campagne ${campaign.status.toLowerCase()}`,
        );
      }

      const updated = await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.CANCELLED },
      });

      // Retirer de la queue si planifiée
      if (campaign.status === CampaignStatus.SCHEDULED) {
        try {
          await this.scheduleQueue.remove(`sched-${campaignId}`);
        } catch (error) {
          this.logger.warn(
            `Failed to remove campaign from queue: ${String(error)}`,
          );
        }
      }

      return updated;
    } catch (error) {
      this.logger.error(`Error cancelling campaign: ${String(error)}`);
      throw error;
    }
  }
}
