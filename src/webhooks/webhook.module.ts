import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { WebhookSubscriptionsController } from './webhook-subscriptions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [WebhookService],
  controllers: [WebhookController, WebhookSubscriptionsController],
  exports: [WebhookService],
})
export class WebhookModule {}
