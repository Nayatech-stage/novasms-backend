import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import type { Campaign, Account, Contact } from '@prisma/client';

type CampaignWithAccount = Campaign & { account: Account };

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

    // Mettre à jour le statut du Send
    await this.prisma.send.updateMany({
      where: {
        campaignId: campaign.id,
        contactId: contact.id,
      },
      data: {
        status: 'BOUNCED',
        bouncedReason: reason,
      },
    });

    // Incrémenter les compteurs de campagne
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        failedCount: { increment: 1 },
      },
    });

    // Marquer le contact comme optout si bounced dur
    if (reason.includes('hard')) {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: { optOut: true },
      });
    }

    this.logger.log(`Email rebondi: ${contact.email} (raison: ${reason})`);
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
}
