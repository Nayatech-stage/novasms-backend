import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';

@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, EmailProviderFactory],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
