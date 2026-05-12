import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ImportService } from './import.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { SegmentRecalculationProcessor } from '../queues/segment.recalculation.queue';
import { SegmentRecalculationService } from '../queues/segment.recalculation.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'segment-recalculation',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
  ],
  controllers: [ContactsController],
  providers: [
    ContactsService,
    ImportService,
    SegmentRecalculationProcessor,
    SegmentRecalculationService,
    PrismaService,
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
