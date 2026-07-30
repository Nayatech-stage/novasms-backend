import { Controller, Post, Body, Request, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MobileMoneyReconciliationService } from './mobile-money.reconciliation.service';
import type { Request as ExpressRequest } from 'express';

/**
 * Controller séparé sans JwtAuthGuard — appelé directement par NovaSend.
 * NovaSend ne peut pas fournir un JWT, donc ce controller est public.
 * Sécurisé par le header X-Webhook-Secret.
 */
@ApiTags('Mobile Money Webhook')
@Controller('mobile-money/webhook')
export class MobileMoneyWebhookController {
  private readonly logger = new Logger(MobileMoneyWebhookController.name);

  constructor(
    private reconciliationService: MobileMoneyReconciliationService,
  ) {}

  @Post('novasend')
  @ApiOperation({
    summary: 'Webhook NovaSend — notification paiement confirmé',
  })
  async novasendWebhook(
    @Body()
    body: { id: string; reference: string; status: string; failure?: unknown },
    @Request() req: ExpressRequest,
  ) {
    const secret = process.env.NOVASEND_WEBHOOK_SECRET;
    if (secret) {
      const received = (req.headers as Record<string, string>)[
        'x-webhook-secret'
      ];
      if (received !== secret) {
        this.logger.warn('[Webhook] Secret invalide — requête rejetée');
        return { success: false, message: 'Unauthorized' };
      }
    }
    this.logger.log(`[Webhook] NovaSend → id=${body.id} status=${body.status}`);
    const result = await this.reconciliationService.handleWebhook(body);
    return { success: true, ...result };
  }
}
