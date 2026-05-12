/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { importQueue } from '../queues/import.queue';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly BATCH_SIZE = 500; // RG-08: performance — traitement par lots

  constructor(private prisma: PrismaService) {}

  /**
   * Lance un import asynchrone via BullMQ
   * Conformité RG-08 (import 50k lignes < 60s) + RG-13 (isolation par accountId)
   */
  async startImport(accountId: string, fileName: string, mappedData: any[]) {
    const jobId = `import-${accountId}-${Date.now()}`;

    await importQueue.add(
      'process-import',
      {
        accountId,
        fileName,
        mappedData,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    this.logger.log(
      `Import job queued: ${jobId} for account ${accountId} (${mappedData.length} rows)`,
    );

    return {
      success: true,
      jobId,
      message: 'Import lancé en arrière-plan',
      estimatedTime: Math.ceil(mappedData.length / 1000) + 's', // Estimation basée sur 1000 lignes/sec
    };
  }

  /**
   * Traite un batch de contacts avec déduplication email OU téléphone
   * Conformité RG-11 (déduplication auto) + RG-13 (isolation stricte par accountId)
   */
  async processBatch(accountId: string, batch: any[]) {
    const result = {
      success: 0,
      duplicates: 0,
      errors: 0,
      details: [] as Array<{
        row: any;
        status?: string;
        error?: string;
        id?: string;
      }>,
    };

    // 1. Récupérer les contacts existants pour déduplication rapide (RG-11)
    // Filtrage strict par accountId (RG-13: isolation multi-tenant)
    const existingContacts = await this.prisma.contact.findMany({
      where: {
        accountId,
        OR: [
          ...batch.filter((c) => c.email).map((c) => ({ email: c.email })),
          ...batch
            .filter((c) => c.phone)
            .map((c) => ({ phone: String(c.phone) })),
        ],
      },
      select: { id: true, email: true, phone: true },
    });

    // 2. Créer un Set pour lookup O(1) — performance critique pour 50k lignes
    const existingSet = new Set(
      existingContacts.flatMap(
        (c) => [c.email, c.phone].filter(Boolean) as string[],
      ),
    );

    // 3. Traiter chaque contact du batch
    for (const contact of batch) {
      const phoneKey = contact.phone ? String(contact.phone) : null;
      // Validation minimale: email OU téléphone requis
      if (!contact.email && !contact.phone) {
        result.errors++;
        result.details.push({
          row: contact,
          error: 'Email ou téléphone requis',
        });
        continue;
      }

      // Détection doublon: email OU téléphone existe déjà dans le compte (RG-11)
      if (
        existingSet.has(contact.email) ||
        (phoneKey && existingSet.has(phoneKey))
      ) {
        result.duplicates++;
        result.details.push({ row: contact, status: 'duplicate' });
        continue;
      }

      // Création du nouveau contact avec isolation stricte (RG-13)
      try {
        const created = await this.prisma.contact.create({
          data: {
            accountId, // 🔑 Isolation multi-tenant obligatoire
            email: contact.email || null,
            phone: phoneKey || null,
            firstName: contact.firstName || null,
            lastName: contact.lastName || null,
            tags: contact.tags || [],
            optOut: false,
          },
        });

        result.success++;
        // Ajouter aux existants pour détection intra-batch
        if (contact.email) existingSet.add(contact.email);
        if (phoneKey) existingSet.add(phoneKey);
        result.details.push({
          row: contact,
          status: 'created',
          id: created.id,
        });
      } catch (error: any) {
        this.logger.error(
          `Failed to create contact: ${error.message}`,
          error.stack,
        );
        result.errors++;
        result.details.push({ row: contact, error: error.message });
      }
    }

    return result;
  }

  /**
   * Génère le rapport d'import conforme RG-12
   * Rapport: succès / doublons ignorés / erreurs de format
   */
  async generateReport(
    accountId: string,
    fileName: string,
    result: {
      success: number;
      duplicates: number;
      errors: number;
      total?: number;
    },
  ) {
    return this.prisma.importReport.create({
      data: {
        accountId,
        fileName,
        totalRecords:
          result.total ?? result.success + result.duplicates + result.errors,
        successCount: result.success,
        duplicateCount: result.duplicates,
        errorCount: result.errors,
      },
    });
  }

  /**
   * Méthode appelée par le worker BullMQ pour traiter l'import complet
   * Découpe en batches de BATCH_SIZE pour respecter RG-08 (<60s pour 50k lignes)
   */
  async processFullImport(accountId: string, fileName: string, allRows: any[]) {
    const total = allRows.length;
    const globalResult = { success: 0, duplicates: 0, errors: 0 };

    // Traitement par batches pour performance et mémoire
    for (let i = 0; i < allRows.length; i += this.BATCH_SIZE) {
      const batch = allRows.slice(i, i + this.BATCH_SIZE);
      const batchResult = await this.processBatch(accountId, batch);

      globalResult.success += batchResult.success;
      globalResult.duplicates += batchResult.duplicates;
      globalResult.errors += batchResult.errors;
    }

    // Générer le rapport final (RG-12)
    const report = await this.generateReport(accountId, fileName, {
      ...globalResult,
      total,
    });

    return {
      jobId: `import-${accountId}-${Date.now()}`,
      status: 'completed',
      report: {
        fileName,
        totalRecords: report.totalRecords,
        successCount: report.successCount,
        duplicateCount: report.duplicateCount,
        errorCount: report.errorCount,
      },
    };
  }
}
