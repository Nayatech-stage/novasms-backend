import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Conformité RGPD (EN-1682) : anonymisation des données personnelles
 * des contacts désabonnés depuis plus de RETENTION_DAYS jours.
 *
 * Les enregistrements sont conservés (statistiques d'envoi) mais toutes
 * les données identifiantes sont effacées de manière irréversible.
 */
@Injectable()
export class GdprAnonymizationService {
  static readonly RETENTION_DAYS = 30;

  private readonly logger = new Logger(GdprAnonymizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async anonymizeExpiredOptOuts(): Promise<{ anonymized: number }> {
    const cutoff = new Date(
      Date.now() -
        GdprAnonymizationService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const expired = await this.prisma.contact.findMany({
      where: {
        optOut: true,
        anonymizedAt: null,
        optOutAt: { not: null, lt: cutoff },
      },
      select: { id: true, accountId: true },
    });

    if (expired.length === 0) {
      return { anonymized: 0 };
    }

    const now = new Date();
    const expiredIds = expired.map((c) => c.id);

    // Batch update — évite le pattern N+1
    await this.prisma.contact.updateMany({
      where: { id: { in: expiredIds } },
      data: {
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        location: null,
        tags: [],
        notes: [],
        anonymizedAt: now,
      },
    });

    await this.prisma.auditLog.createMany({
      data: expired.map((contact) => ({
        accountId: contact.accountId,
        action: 'contact.gdpr_anonymized',
        details: {
          contactId: contact.id,
          retentionDays: GdprAnonymizationService.RETENTION_DAYS,
        },
      })),
    });

    this.logger.log(
      `RGPD: ${expired.length} contact(s) anonymisé(s) (désabonnés depuis plus de ${GdprAnonymizationService.RETENTION_DAYS} jours)`,
    );
    return { anonymized: expired.length };
  }
}
