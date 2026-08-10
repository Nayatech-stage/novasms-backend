import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackController } from './track.controller';
import { TrackService } from './track.service';

@Module({
  imports: [PrismaModule, EventEmitterModule],
  controllers: [TrackController],
  providers: [TrackService],
  exports: [TrackService],
})
export class TrackModule {}
