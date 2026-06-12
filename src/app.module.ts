import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule'; // ✅ Ajouter cet import
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { ContactsModule } from './contacts/contacts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AutomationsModule } from './automations/automations.module';
import { WebhookModule } from './webhooks/webhook.module';
import { TemplatesModule } from './templates/templates.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { MobileMoneyModule } from './mobile-money/mobile-money.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AccountModule } from './account/account.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { SegmentsModule } from './segments/segments.module';
import { TrackModule } from './track/track.module';
import { EmailProviderFactory } from './providers/email/email.provider.factory';
import { SmsProviderFactory } from './providers/sms/sms.provider.factory';
import { WhatsappProviderFactory } from './providers/whatsapp/whatsapp.provider.factory';
import { PaymentProviderFactory } from './providers/payment/payment.provider.factory';

const isTestEnvironment =
  process.env.NODE_ENV === 'test' ||
  typeof process.env.JEST_WORKER_ID !== 'undefined';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...(isTestEnvironment ? [] : [ScheduleModule.forRoot()]),
    EventEmitterModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    // Register the automation queue at the application level so the InjectQueue
    // token is resolvable for modules that depend on it.
    BullModule.registerQueue({ name: 'automation-execute' }),
    PrismaModule,
    AuthModule,
    MailModule,
    ContactsModule,
    CampaignsModule,
    AutomationsModule,
    TemplatesModule,
    AnalyticsModule,
    MobileMoneyModule,
    TransactionsModule,
    AccountModule,
    AuditLogsModule,
    SegmentsModule,
    TrackModule,
    WebhookModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    EmailProviderFactory,
    SmsProviderFactory,
    WhatsappProviderFactory,
    PaymentProviderFactory,
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
