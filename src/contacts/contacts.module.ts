import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ImportService } from './import.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { GdprAnonymizationService } from './gdpr-anonymization.service';
import { SegmentRecalculationProcessor } from '../queues/segment.recalculation.queue';
import { SegmentRecalculationService } from '../queues/segment.recalculation.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    EventEmitterModule,
    BullModule.registerQueue({
      name: 'segment-recalculation',
    }),
  ],
  controllers: [ContactsController],
  providers: [
    ContactsService,
    GdprAnonymizationService,
    ImportService,
    SegmentRecalculationProcessor,
    SegmentRecalculationService,
    PrismaService,
  ],
  exports: [ContactsService, ImportService],
})
export class ContactsModule {}
