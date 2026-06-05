import { Module } from '@nestjs/common';
import { MobileMoneyController } from './mobile-money.controller';
import { MobileMoneyService } from './mobile-money.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [MobileMoneyService],
  controllers: [MobileMoneyController],
  exports: [MobileMoneyService],
})
export class MobileMoneyModule {}
