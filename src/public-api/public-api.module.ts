import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PublicApiController } from './public-api.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ContactsModule } from '../contacts/contacts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyLogInterceptor } from '../api-keys/api-key-log.interceptor';
import { ApiKeyThrottlerGuard } from '../api-keys/api-key-throttler.guard';

@Module({
  imports: [ApiKeysModule, ContactsModule, PrismaModule],
  controllers: [PublicApiController],
  providers: [
    SmsProviderFactory,
    EmailProviderFactory,
    ApiKeyGuard,
    ApiKeyThrottlerGuard,
    { provide: APP_INTERCEPTOR, useClass: ApiKeyLogInterceptor },
  ],
})
export class PublicApiModule {}
