import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { FileUploadService } from './file-upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { CampaignDispatchProcessor } from '../queues/campaign.dispatch.queue';
import { CampaignScheduleWorker } from '../queues/campaign.schedule.worker';

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
    CampaignScheduleWorker,
  ],
  exports: [CampaignsService],
})
export class CampaignsModule {}
