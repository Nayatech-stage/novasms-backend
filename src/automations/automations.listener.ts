import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutomationsService } from './automations.service';
import type {
  CampaignEvent,
  ContactAddedEvent,
  SegmentJoinedEvent,
} from './automations.types';

@Injectable()
export class ContactAddedListener {
  private readonly logger = new Logger(ContactAddedListener.name);

  constructor(private readonly automationsService: AutomationsService) {}

  @OnEvent('contact.added')
  async handleContactAdded(event: ContactAddedEvent) {
    try {
      await this.automationsService.scheduleContactAddedAutomations(event);
    } catch (error: unknown) {
      this.logger.error(
        `Impossible de planifier les automations pour le contact ${event.contactId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @OnEvent('segment.joined')
  async handleSegmentJoined(event: SegmentJoinedEvent) {
    try {
      await this.automationsService.scheduleSegmentJoinedAutomations(event);
    } catch (error: unknown) {
      this.logger.error(
        `Impossible de planifier les automations pour le segment ${event.segmentId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @OnEvent('campaign.opened')
  async handleCampaignOpened(event: CampaignEvent) {
    try {
      await this.automationsService.scheduleCampaignOpenedAutomations(event);
    } catch (error: unknown) {
      this.logger.error(
        `Impossible de planifier les automations pour l'ouverture de campagne ${event.campaignId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @OnEvent('campaign.clicked')
  async handleCampaignClicked(event: CampaignEvent) {
    try {
      await this.automationsService.scheduleCampaignClickedAutomations(event);
    } catch (error: unknown) {
      this.logger.error(
        `Impossible de planifier les automations pour le clic de campagne ${event.campaignId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
