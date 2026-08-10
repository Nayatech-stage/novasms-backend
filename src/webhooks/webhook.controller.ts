import { Controller, Post, Body, Logger, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBody } from '@nestjs/swagger';
import {
  WebhookService,
  type WebhookPayload,
  type WebhookHeaders,
} from './webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

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
  async receiveEmailWebhook(
    @Headers() headers: WebhookHeaders,
    @Body() payload: WebhookPayload,
    @Req() req: Request,
  ) {
    this.logger.log(`Webhook reçu: ${payload.event}`);

    this.webhookService.assertProviderSignature(
      'email-events',
      process.env.RESEND_WEBHOOK_SECRET,
      headers,
      req,
      payload,
      ['x-resend-signature', 'resend-signature', 'x-signature', 'signature'],
    );

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

  @Post('health')
  healthCheck() {
    return { status: 'healthy', timestamp: new Date(), webhooksEnabled: true };
  }

  @Post('resend')
  async receiveResendWebhook(
    @Headers() headers: WebhookHeaders,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.webhookService.assertSvixSignature(
      process.env.RESEND_WEBHOOK_SECRET,
      headers,
      req,
    );
    const result = await this.webhookService.receiveResendWebhook(payload);
    return { success: true, ...result };
  }

  @Post('africastalking')
  async receiveAfricasTalkingWebhook(
    @Headers() headers: WebhookHeaders,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.webhookService.assertProviderSignature(
      'africastalking',
      process.env.AFRICASTALKING_WEBHOOK_SECRET,
      headers,
      req,
      payload,
      [
        'x-africastalking-signature',
        'africastalking-signature',
        'x-signature',
        'signature',
      ],
    );
    const result = await this.webhookService.receiveSmsWebhook(
      'africastalking',
      payload,
    );
    return { success: true, ...result };
  }

  @Post('twilio')
  async receiveTwilioWebhook(
    @Headers() headers: WebhookHeaders,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.webhookService.assertProviderSignature(
      'twilio',
      process.env.TWILIO_WEBHOOK_SECRET,
      headers,
      req,
      payload,
      ['x-twilio-signature', 'twilio-signature', 'x-signature', 'signature'],
    );
    const result = await this.webhookService.receiveSmsWebhook(
      'twilio',
      payload,
    );
    return { success: true, ...result };
  }

  @Post('stripe')
  async receiveStripeWebhook(
    @Headers() headers: WebhookHeaders,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.webhookService.assertStripeSignature(
      process.env.STRIPE_WEBHOOK_SECRET,
      headers,
      req,
      payload,
    );
    const result = await this.webhookService.receiveStripeWebhook(payload);
    return { success: true, ...result };
  }
}
