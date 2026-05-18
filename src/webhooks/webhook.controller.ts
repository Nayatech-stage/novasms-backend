import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiBody } from '@nestjs/swagger';
import { WebhookService, type WebhookPayload } from './webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

  /**
   * Endpoint pour recevoir les événements email
   * POST /webhooks/email-events
   *
   * Payload:
   * {
   *   "event": "email.sent" | "email.opened" | "email.clicked" | "email.bounced",
   *   "campaignId": "uuid",
   *   "contactId": "uuid",
   *   "timestamp": "2026-05-18T12:00:00Z",
   *   "metadata": { "reason": "..." }
   * }
   */
  @Post('email-events')
  @ApiBody({
    schema: {
      example: {
        event: 'email.sent',
        campaignId: 'campaign-123',
        contactId: 'contact-456',
        timestamp: new Date().toISOString(),
        metadata: {},
      },
    },
  })
  async receiveEmailWebhook(@Body() payload: WebhookPayload) {
    this.logger.log(`Webhook reçu: ${payload.event}`);

    try {
      const result = await this.webhookService.receiveWebhook(payload);
      return {
        success: true,
        webhookId: result.id,
        processed: result.processed,
        event: result.event,
      };
    } catch (error) {
      this.logger.error(`Erreur webhook: ${String(error)}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Endpoint de test pour vérifier que les webhooks fonctionnent
   * GET /webhooks/health
   */
  @Post('health')
  healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date(),
      webhooksEnabled: true,
    };
  }
}
