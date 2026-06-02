import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContactsModule } from '../contacts/contacts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { WhatsappProviderFactory } from '../providers/whatsapp/whatsapp.provider.factory';
import { AutomationExecutionProcessor } from './automation.execute.queue';
import { AutomationsController } from './automations.controller';
import { ContactAddedListener } from './automations.listener';
import { AutomationsService } from './automations.service';

const isTestEnvironment =
  process.env.NODE_ENV === 'test' ||
  typeof process.env.JEST_WORKER_ID !== 'undefined';

@Module({
  imports: [
    PrismaModule,
    ContactsModule,
    BullModule.registerQueue({
      name: 'automation-execute',
    }),
  ],
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    ContactAddedListener,
    AutomationExecutionProcessor,
    EmailProviderFactory,
    SmsProviderFactory,
    WhatsappProviderFactory,
    // Fallback provider for older/alternate Bull injection token names.
    {
      provide: 'BullQueue_default',
      useFactory: () => {
        if (isTestEnvironment) {
          return {
            add: async () => undefined,
            close: async () => undefined,
          };
        }

        // create a local Queue instance bound to the automation-execute queue name
        // so the AutomationsService can inject it even if the BullModule provider
        // token differs in this environment.

        const { Queue } = require('bullmq');
        return new Queue('automation-execute', {
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
          },
        });
      },
    },
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}
