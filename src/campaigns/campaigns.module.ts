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

@Module({
  imports: [
    PrismaModule,
    MailModule,
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
  ],
  exports: [CampaignsService],
})
export class CampaignsModule {}
