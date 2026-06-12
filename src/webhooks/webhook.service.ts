import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  AnalyticAction,
  Prisma,
  SendStatus,
  TransactionMethod,
  TransactionStatus,
} from '@prisma/client';
import type { Campaign, Account, Contact } from '@prisma/client';

type CampaignWithAccount = Campaign & { account: Account };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  if (/^00\d{8,15}$/.test(cleaned)) return `+${cleaned.slice(2)}`;
  if (/^\d{8,15}$/.test(cleaned)) return `+${cleaned}`;
  return undefined;
}

export interface WebhookPayload {
  event: 'email.sent' | 'email.opened' | 'email.clicked' | 'email.bounced';
  campaignId: string;
  contactId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookEvent {
  id: string;
  campaignId: string;
  event: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
  processed: boolean;
  processedAt?: Date;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Recevoir et traiter un webhook d'événement email
   */
  async receiveWebhook(payload: WebhookPayload): Promise<WebhookEvent> {
    this.logger.debug(
      `Webhook reçu: ${payload.event} pour campagne ${payload.campaignId}`,
    );

    try {
      // Récupérer la campagne
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: payload.campaignId },
        include: { account: true },
      });

      if (!campaign) {
        this.logger.warn(`Campagne non trouvée: ${payload.campaignId}`);
        throw new Error('Campaign not found');
      }

      // Récupérer le contact
      const contact = await this.prisma.contact.findUnique({
        where: { id: payload.contactId },
      });

      if (!contact) {
        this.logger.warn(`Contact non trouvé: ${payload.contactId}`);
        throw new Error('Contact not found');
      }

      // Traiter l'événement
      switch (payload.event) {
        case 'email.sent':
          await this.handleEmailSent(campaign, contact, payload);
          break;
        case 'email.opened':
          await this.handleEmailOpened(campaign, contact, payload);
          break;
        case 'email.clicked':
          await this.handleEmailClicked(campaign, contact, payload);
          break;
        case 'email.bounced':
          await this.handleEmailBounced(campaign, contact, payload);
          break;
      }

      // Créer un enregistrement du webhook reçu (pour audit)
      // Note: En production, stocker dans une table dédiée WebhookLog
      this.logger.log(
        `Webhook traité avec succès: ${payload.event} (campagne: ${payload.campaignId})`,
      );

      return {
        id: `webhook-${Date.now()}`,
        campaignId: payload.campaignId,
        event: payload.event,
        payload: payload as unknown as Record<string, unknown>,
        receivedAt: new Date(),
        processed: true,
        processedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Erreur lors du traitement du webhook: ${String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Gérer événement: email.sent
   */
  private async handleEmailSent(
    campaign: CampaignWithAccount,
    contact: Contact,
    payload: WebhookPayload,
  ) {
    // Mettre à jour le statut du Send
    await this.prisma.send.updateMany({
      where: {
        campaignId: campaign.id,
        contactId: contact.id,
      },
      data: {
        status: 'SENT',
        sentAt: payload.timestamp,
      },
    });

    // Incrémenter les compteurs de campagne
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        sentCount: { increment: 1 },
      },
    });

    // Envoyer email de confirmation au admin
    await this.mailService.sendCampaignConfirmation(
      campaign.account.adminEmail,
      {
        campaignName: campaign.name,
        contactEmail: contact.email ?? '',
        sentAt: payload.timestamp,
        campaignId: campaign.id,
      },
    );

    this.logger.log(
      `Email envoyé confirmé: ${contact.email} (campagne: ${campaign.id})`,
    );
  }

  /**
   * Gérer événement: email.opened
   */
  private async handleEmailOpened(
    campaign: CampaignWithAccount,
    contact: Contact,
    payload: WebhookPayload,
  ) {
    // Mettre à jour le statut du Send
    await this.prisma.send.updateMany({
      where: {
        campaignId: campaign.id,
        contactId: contact.id,
      },
      data: {
        status: 'OPENED',
        openedAt: payload.timestamp,
      },
    });

    // Incrémenter les compteurs de campagne
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        openedCount: { increment: 1 },
      },
    });

    // Créer événement analytique
    await this.prisma.analytic.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        action: 'Open',
        createdAt: payload.timestamp,
      },
    });

    this.logger.log(
      `Email ouvert: ${contact.email} (campagne: ${campaign.id})`,
    );

    this.eventEmitter.emit('campaign.opened', {
      accountId: campaign.accountId,
      campaignId: campaign.id,
      contactId: contact.id,
    });
  }

  /**
   * Gérer événement: email.clicked
   */
  private async handleEmailClicked(
    campaign: CampaignWithAccount,
    contact: Contact,
    payload: WebhookPayload,
  ) {
    // Mettre à jour le statut du Send
    await this.prisma.send.updateMany({
      where: {
        campaignId: campaign.id,
        contactId: contact.id,
      },
      data: {
        status: 'CLICKED',
        clickedAt: payload.timestamp,
      },
    });

    // Incrémenter les compteurs de campagne
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        clickedCount: { increment: 1 },
      },
    });

    // Créer événement analytique
    await this.prisma.analytic.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        action: 'Click',
        createdAt: payload.timestamp,
      },
    });

    this.logger.log(
      `Email cliqué: ${contact.email} (campagne: ${campaign.id})`,
    );

    this.eventEmitter.emit('campaign.clicked', {
      accountId: campaign.accountId,
      campaignId: campaign.id,
      contactId: contact.id,
    });
  }

  /**
   * Gérer événement: email.bounced
   */
  private async handleEmailBounced(
    campaign: CampaignWithAccount,
    contact: Contact,
    payload: WebhookPayload,
  ) {
    const reason = (payload.metadata?.reason as string) || 'Unknown';

    // US-007: classification hard/soft/complaint
    const isHardBounce =
      /^(hard|permanent|invalid|not_delivered|user_unknown|no_such_user)/i.test(
        reason,
      );
    const isSoftBounce =
      /^(soft|temporary|mailbox_full|over_quota|too_many_connections)/i.test(
        reason,
      );
    const isComplaint = /^(complaint|spam|abuse|unsubscribe)/i.test(reason);
    const bounceType = isHardBounce
      ? 'HARD'
      : isSoftBounce
        ? 'SOFT'
        : isComplaint
          ? 'COMPLAINT'
          : 'UNKNOWN';

    // Mettre à jour le statut du Send
    await this.prisma.send.updateMany({
      where: {
        campaignId: campaign.id,
        contactId: contact.id,
      },
      data: {
        status: 'BOUNCED',
        bouncedReason: `${bounceType}: ${reason}`,
      },
    });

    // Incrémenter les compteurs de campagne
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        failedCount: { increment: 1 },
      },
    });

    // Optout uniquement sur bounce dur ou plainte (pas soft)
    if (isHardBounce || isComplaint) {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: { optOut: true, optOutAt: new Date() },
      });
    }

    this.logger.log(
      `Email rebondi: ${contact.email} (type: ${bounceType}, raison: ${reason})`,
    );
  }

  /**
   * Obtenir les webhooks reçus pour une campagne
   */
  async getCampaignWebhooks(campaignId: string) {
    return this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        sentCount: true,
        deliveredCount: true,
        openedCount: true,
        clickedCount: true,
        failedCount: true,
      },
    });
  }

  async receiveResendWebhook(payload: Record<string, unknown>) {
    const eventType =
      asString(payload.type) || asString(payload.event) || 'unknown';
    const data = asRecord(payload.data) || payload;
    const sendId = asString(data.sendId) || asString(data.send_id);

    if (!sendId) {
      return { processed: false, reason: 'missing-send-id', eventType };
    }

    const send = await this.prisma.send.findUnique({
      where: { id: sendId },
      select: {
        id: true,
        campaignId: true,
        contactId: true,
        status: true,
        openedAt: true,
        clickedAt: true,
        campaign: { select: { accountId: true } },
      },
    });

    if (!send) {
      return { processed: false, reason: 'send-not-found', sendId, eventType };
    }

    const now = new Date();
    const event = eventType.toLowerCase();

    if (event.includes('open')) {
      const result = await this.prisma.send.updateMany({
        where: { id: sendId, openedAt: null },
        data: {
          openedAt: now,
          status:
            send.status === SendStatus.CLICKED
              ? SendStatus.CLICKED
              : SendStatus.OPENED,
        },
      });
      if (result.count > 0) {
        await this.prisma.campaign.update({
          where: { id: send.campaignId },
          data: { openedCount: { increment: 1 } },
        });
        await this.prisma.analytic.create({
          data: {
            campaignId: send.campaignId,
            contactId: send.contactId,
            action: AnalyticAction.Open,
            createdAt: now,
          },
        });
      }
    } else if (event.includes('click')) {
      const result = await this.prisma.send.updateMany({
        where: { id: sendId, clickedAt: null },
        data: { clickedAt: now, status: SendStatus.CLICKED },
      });
      if (result.count > 0) {
        await this.prisma.campaign.update({
          where: { id: send.campaignId },
          data: { clickedCount: { increment: 1 } },
        });
        await this.prisma.analytic.create({
          data: {
            campaignId: send.campaignId,
            contactId: send.contactId,
            action: AnalyticAction.Click,
            createdAt: now,
          },
        });
      }
    } else if (
      event.includes('bounce') ||
      event.includes('complain') ||
      event.includes('spam')
    ) {
      const result = await this.prisma.send.updateMany({
        where: { id: sendId, status: { not: SendStatus.BOUNCED } },
        data: {
          status: SendStatus.BOUNCED,
          bouncedReason: eventType,
        },
      });
      if (result.count > 0) {
        await this.prisma.campaign.update({
          where: { id: send.campaignId },
          data: { failedCount: { increment: 1 } },
        });
        await this.prisma.analytic.create({
          data: {
            campaignId: send.campaignId,
            contactId: send.contactId,
            action: AnalyticAction.Bounce,
            createdAt: now,
          },
        });
      }
    } else if (event.includes('unsubscribe')) {
      await this.prisma.contact.updateMany({
        where: { id: send.contactId },
        data: { optOut: true, optOutAt: new Date() },
      });
      const result = await this.prisma.send.updateMany({
        where: { id: sendId, status: { not: SendStatus.UNSUBSCRIBED } },
        data: { status: SendStatus.UNSUBSCRIBED },
      });
      if (result.count > 0) {
        await this.prisma.analytic.create({
          data: {
            campaignId: send.campaignId,
            contactId: send.contactId,
            action: AnalyticAction.Unsubscribe,
            createdAt: now,
          },
        });
      }
    }

    await this.prisma.auditLog.create({
      data: {
        accountId: send.campaign.accountId,
        action: `webhook_resend_${eventType}`,
        details: payload as Prisma.InputJsonValue,
      },
    });

    return { processed: true, sendId, eventType };
  }

  async receiveSmsWebhook(
    provider: 'africastalking' | 'twilio',
    payload: Record<string, unknown>,
  ) {
    const eventType =
      asString(payload.event) ||
      asString(payload.status) ||
      asString(payload.type) ||
      'unknown';

    const data = asRecord(payload.data) || payload;
    const phone =
      normalizePhone(asString(data.phoneNumber)) ||
      normalizePhone(asString(data.phone)) ||
      normalizePhone(asString(data.to)) ||
      normalizePhone(asString(data.from));
    const body = asString(data.text) || asString(data.body) || '';

    if (!phone) {
      return { processed: false, reason: 'missing-phone', eventType, provider };
    }

    const contacts = await this.prisma.contact.findMany({
      where: { phone },
      select: { id: true, accountId: true },
    });

    if (contacts.length === 0) {
      return {
        processed: false,
        reason: 'contact-not-found',
        eventType,
        provider,
      };
    }

    const isStop = /\bstop\b/i.test(body) || /\bunsubscribe\b/i.test(eventType);
    const isFailed = /fail|bounce|undeliver/i.test(eventType);

    await this.prisma.$transaction(async (tx) => {
      for (const contact of contacts) {
        if (isStop) {
          await tx.contact.update({
            where: { id: contact.id },
            data: { optOut: true, optOutAt: new Date() },
          });

          await tx.send.updateMany({
            where: {
              contactId: contact.id,
              status: {
                in: [SendStatus.SENT, SendStatus.OPENED, SendStatus.CLICKED],
              },
            },
            data: { status: SendStatus.UNSUBSCRIBED },
          });
        }

        if (isFailed) {
          await tx.send.updateMany({
            where: {
              contactId: contact.id,
              status: {
                in: [SendStatus.PENDING, SendStatus.SENT],
              },
            },
            data: {
              status: SendStatus.BOUNCED,
              bouncedReason: `${provider}:${eventType}`,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            accountId: contact.accountId,
            action: `webhook_${provider}_${eventType}`,
            details: payload as Prisma.InputJsonValue,
          },
        });
      }
    });

    return { processed: true, provider, eventType, contacts: contacts.length };
  }

  async receiveStripeWebhook(payload: Record<string, unknown>) {
    const eventType = asString(payload.type) || 'unknown';
    const data = asRecord(payload.data);
    const object = asRecord(data?.object);
    const metadata = asRecord(object?.metadata);

    const accountId = asString(metadata?.accountId);
    const paymentIntentId = asString(object?.id);
    const amountReceived =
      typeof object?.amount_received === 'number'
        ? object.amount_received
        : typeof object?.amount === 'number'
          ? object.amount
          : 0;

    if (!accountId) {
      return { processed: false, reason: 'missing-account-id', eventType };
    }

    const amountFcfa = amountReceived > 0 ? amountReceived / 100 : 0;
    const succeeded = eventType === 'payment_intent.succeeded';

    await this.prisma.$transaction(async (tx) => {
      if (succeeded && amountFcfa > 0) {
        await tx.account.update({
          where: { id: accountId },
          data: { creditBalance: { increment: amountFcfa } },
        });
      }

      await tx.transaction.create({
        data: {
          accountId,
          amount: amountFcfa,
          method: TransactionMethod.Visa,
          reference: paymentIntentId,
          status: succeeded
            ? TransactionStatus.Validated
            : TransactionStatus.Refused,
        },
      });

      await tx.auditLog.create({
        data: {
          accountId,
          action: `webhook_stripe_${eventType}`,
          details: payload as Prisma.InputJsonValue,
        },
      });
    });

    return {
      processed: true,
      eventType,
      accountId,
      amountFcfa,
      paymentIntentId,
    };
  }
}
