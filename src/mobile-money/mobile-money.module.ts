import { Module } from '@nestjs/common';
import { MobileMoneyController } from './mobile-money.controller';
import { MobileMoneyService } from './mobile-money.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentProviderFactory } from '../providers/payment/payment.provider.factory';

@Module({
  imports: [PrismaModule],
  providers: [MobileMoneyService, PaymentProviderFactory],
  controllers: [MobileMoneyController],
  exports: [MobileMoneyService],
})
export class MobileMoneyModule {}
