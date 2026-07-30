import { Module } from '@nestjs/common';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthModule } from '../auth/jwt-auth.module';

@Module({
  imports: [PrismaModule, JwtAuthModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
