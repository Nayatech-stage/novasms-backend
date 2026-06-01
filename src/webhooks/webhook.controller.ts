import { Controller, Post, Body, Logger, Headers, BadRequestException, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
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
  async receiveEmailWebhook(@Headers() headers: Record<string, string | string[]>, @Body() payload: WebhookPayload, @Req() req: Request) {
    this.logger.log(`Webhook reçu: ${payload.event}`);

    // Optional HMAC verification if a secret is configured
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (secret) {
      try {
        const sigHeader = (headers['x-resend-signature'] || headers['resend-signature'] || headers['x-signature'] || headers['signature']) as string | undefined;
        if (sigHeader) {
          const payloadString = req['rawBody'] ? req['rawBody'].toString() : JSON.stringify(payload);
          const expected = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
          if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader))) {
            this.logger.warn('Webhook signature mismatch');
            throw new BadRequestException('Invalid webhook signature');
          }
        } else {
          this.logger.warn('RESEND_WEBHOOK_SECRET set but no signature header provided');
        }
      } catch (err) {
        this.logger.error('Webhook signature verification failed');
        throw err;
      }
    }

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
