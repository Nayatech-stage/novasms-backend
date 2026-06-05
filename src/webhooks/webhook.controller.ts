import {
  Controller,
  Post,
  Body,
  Logger,
  Headers,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { ApiTags, ApiBody } from '@nestjs/swagger';
import { WebhookService, type WebhookPayload } from './webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

  private getRawBody(req: Request, payload: unknown): string {
    const raw = req['rawBody'];
    if (Buffer.isBuffer(raw)) {
      return raw.toString();
    }
    return JSON.stringify(payload ?? {});
  }

  private getHeaderValue(
    headers: Record<string, string | string[]>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = headers[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
      if (Array.isArray(value) && value.length > 0) {
        const first = value.find(
          (item) => typeof item === 'string' && item.trim().length > 0,
        );
        if (first) return first.trim();
      }
    }
    return undefined;
  }

  private verifyHmacSha256Hex(
    body: string,
    secret: string,
    signature: string,
  ): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  private assertGenericProviderSignature(
    provider: string,
    secret: string | undefined,
    headers: Record<string, string | string[]>,
    req: Request,
    payload: unknown,
    headerKeys: string[],
  ) {
    if (!secret?.trim()) return;

    const signature = this.getHeaderValue(headers, headerKeys);
    if (!signature) {
      this.logger.warn(`${provider} webhook rejected: missing signature`);
      throw new BadRequestException('Missing webhook signature');
    }

    const rawBody = this.getRawBody(req, payload);
    const isValid = this.verifyHmacSha256Hex(rawBody, secret, signature);
    if (!isValid) {
      this.logger.warn(`${provider} webhook rejected: invalid signature`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  private assertStripeSignature(
    secret: string | undefined,
    headers: Record<string, string | string[]>,
    req: Request,
    payload: unknown,
  ) {
    if (!secret?.trim()) return;

    const stripeSignature = this.getHeaderValue(headers, ['stripe-signature']);
    if (!stripeSignature) {
      this.logger.warn('Stripe webhook rejected: missing stripe-signature');
      throw new BadRequestException('Missing webhook signature');
    }

    const rawBody = this.getRawBody(req, payload);
    const segments = stripeSignature.split(',').map((part) => part.trim());
    const timestamp = segments.find((part) => part.startsWith('t='))?.slice(2);
    const signatures = segments
      .filter((part) => part.startsWith('v1='))
      .map((part) => part.slice(3));

    if (!timestamp || signatures.length === 0) {
      throw new BadRequestException('Invalid webhook signature header');
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const hasMatch = signatures.some((candidate) => {
      const expectedBuffer = Buffer.from(expected, 'utf8');
      const candidateBuffer = Buffer.from(candidate, 'utf8');
      if (expectedBuffer.length !== candidateBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
    });

    if (!hasMatch) {
      this.logger.warn('Stripe webhook rejected: invalid signature');
      throw new BadRequestException('Invalid webhook signature');
    }
  }

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
  async receiveEmailWebhook(
    @Headers() headers: Record<string, string | string[]>,
    @Body() payload: WebhookPayload,
    @Req() req: Request,
  ) {
    this.logger.log(`Webhook reçu: ${payload.event}`);

    // Optional HMAC verification if a secret is configured
    this.assertGenericProviderSignature(
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

  @Post('resend')
  async receiveResendWebhook(
    @Headers() headers: Record<string, string | string[]>,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.assertGenericProviderSignature(
      'resend',
      process.env.RESEND_WEBHOOK_SECRET,
      headers,
      req,
      payload,
      ['x-resend-signature', 'resend-signature', 'x-signature', 'signature'],
    );

    const result = await this.webhookService.receiveResendWebhook(payload);
    return { success: true, ...result };
  }

  @Post('africastalking')
  async receiveAfricasTalkingWebhook(
    @Headers() headers: Record<string, string | string[]>,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.assertGenericProviderSignature(
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
    @Headers() headers: Record<string, string | string[]>,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.assertGenericProviderSignature(
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
    @Headers() headers: Record<string, string | string[]>,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.assertStripeSignature(
      process.env.STRIPE_WEBHOOK_SECRET,
      headers,
      req,
      payload,
    );

    const result = await this.webhookService.receiveStripeWebhook(payload);
    return { success: true, ...result };
  }
}
