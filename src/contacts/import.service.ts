import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { importQueue } from '../queues/import.queue';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

export type ImportRow = {
  email?: string;
  phone?: string | number;
  firstName?: string;
  lastName?: string;
  location?: string;
  tags?: string[];
};

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly BATCH_SIZE = 500; // RG-08: performance — traitement par lots

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Lance un import asynchrone via BullMQ
   * Conformité RG-08 (import 50k lignes < 60s) + RG-13 (isolation par accountId)
   */
  async startImport(
    accountId: string,
    fileName: string,
    mappedData: ImportRow[],
  ) {
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
  async processBatch(accountId: string, batch: ImportRow[]) {
    const result = {
      success: 0,
      duplicates: 0,
      errors: 0,
      details: [] as Array<{
        row: ImportRow;
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
        (contact.email && existingSet.has(contact.email)) ||
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
        this.eventEmitter.emit('contact.added', {
          accountId,
          contactId: created.id,
          contact: created,
        });
        result.details.push({
          row: contact,
          status: 'created',
          id: created.id,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Failed to create contact: ${err.message}`,
          err.stack,
        );
        result.errors++;
        result.details.push({ row: contact, error: err.message });
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
  async processFullImport(
    accountId: string,
    fileName: string,
    allRows: ImportRow[],
  ) {
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

  /**
   * Lance un import asynchrone via BullMQ à partir d'un fichier NDJSON déjà uploadé.
   * Retourne immédiatement un jobId — le traitement se fait en arrière-plan.
   */
  async startImportFromFile(
    accountId: string,
    fileName: string,
    filePath: string,
  ) {
    const jobId = `import-${accountId}-${Date.now()}`;
    await importQueue.add(
      'process-import',
      { accountId, fileName, filePath },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
    this.logger.log(
      `Import file job queued: ${jobId} for account ${accountId} file: ${filePath}`,
    );
    return { success: true, jobId };
  }

  /**
   * Traite un fichier NDJSON d'import ligne par ligne en batches
   * Evite de charger tout le fichier en mémoire pour les gros imports
   */
  async processFullImportFromFile(
    accountId: string,
    fileName: string,
    filePath: string,
  ) {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    const globalResult = { success: 0, duplicates: 0, errors: 0 };
    const batch: ImportRow[] = [];

    for await (const line of rl) {
      if (!line) continue;
      try {
        const row = JSON.parse(line);
        batch.push(row);
      } catch (e) {
        this.logger.warn('Skipping invalid JSON line during import streaming');
        globalResult.errors++;
      }

      if (batch.length >= this.BATCH_SIZE) {
        const r = await this.processBatch(accountId, batch.splice(0));
        globalResult.success += r.success;
        globalResult.duplicates += r.duplicates;
        globalResult.errors += r.errors;
      }
    }

    if (batch.length > 0) {
      const r = await this.processBatch(accountId, batch.splice(0));
      globalResult.success += r.success;
      globalResult.duplicates += r.duplicates;
      globalResult.errors += r.errors;
    }

    // Générer le rapport final
    const report = await this.generateReport(accountId, fileName, {
      ...globalResult,
      total:
        globalResult.success + globalResult.duplicates + globalResult.errors,
    });

    // Tentative de cleanup du fichier temporaire
    try {
      await fs.promises.unlink(filePath);
    } catch (e) {
      // ignore
    }

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
