import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AccountController],
})
export class AccountModule {}
