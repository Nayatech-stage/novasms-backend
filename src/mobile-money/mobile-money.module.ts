import { Module } from '@nestjs/common';
import { MobileMoneyController } from './mobile-money.controller';
import { MobileMoneyWebhookController } from './mobile-money.webhook.controller';
import { MobileMoneyService } from './mobile-money.service';
import { MobileMoneyReconciliationService } from './mobile-money.reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentProviderFactory } from '../providers/payment/payment.provider.factory';
import { SystemConfigService } from '../common/system-config.service';

@Module({
  imports: [PrismaModule],
  providers: [
    MobileMoneyService,
    PaymentProviderFactory,
    SystemConfigService,
    MobileMoneyReconciliationService,
  ],
  controllers: [MobileMoneyController, MobileMoneyWebhookController],
  exports: [MobileMoneyService],
})
export class MobileMoneyModule {}
