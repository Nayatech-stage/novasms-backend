import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { FileUploadService } from './file-upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { CampaignDispatchProcessor } from '../queues/campaign.dispatch.queue';
import { CampaignScheduleProcessor } from '../queues/campaign.schedule.queue';
import { CampaignScheduleWorker } from '../queues/campaign.schedule.worker';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { WhatsappProviderFactory } from '../providers/whatsapp/whatsapp.provider.factory';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    ContactsModule,
    BullModule.registerQueue(
      { name: 'campaign-dispatch' },
      { name: 'campaign-schedule' },
    ),
  ],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    FileUploadService,
    CampaignDispatchProcessor,
    CampaignScheduleProcessor,
    CampaignScheduleWorker,
    EmailProviderFactory,
    SmsProviderFactory,
    WhatsappProviderFactory,
  ],
  exports: [CampaignsService],
})
export class CampaignsModule {}
