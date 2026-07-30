import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthModule } from '../auth/jwt-auth.module';

@Module({
  imports: [PrismaModule, JwtAuthModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
