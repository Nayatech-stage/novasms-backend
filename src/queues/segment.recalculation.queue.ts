/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('Unknown error');
};

export interface SegmentRecalculationJob {
  segmentId: string;
  accountId: string;
}

@Processor('segment-recalculation')
export class SegmentRecalculationProcessor {
  private readonly logger = new Logger(SegmentRecalculationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private contactsService: ContactsService,
  ) {}

  @Process({
    name: 'recalculate-segment',
    concurrency: 5,
  })
  async handleRecalculateSegment(job: Job<SegmentRecalculationJob>) {
    const { segmentId, accountId } = job.data;

    this.logger.log(
      'Recalculating segment ' + segmentId + ' for account ' + accountId,
    );

    try {
      // Fetch the segment
      const segment = await this.prisma.segment.findUnique({
        where: { id: segmentId, accountId },
      });

      if (!segment) {
        throw new Error(
          'Segment ' + segmentId + ' not found for account ' + accountId,
        );
      }

      if (segment.type !== 'dynamic') {
        this.logger.warn(
          'Segment ' + segmentId + ' is not dynamic, skipping recalculation',
        );
        return {
          success: true,
          skipped: true,
          reason: 'Not a dynamic segment',
        };
      }

      // Parse the criteria
      const parsed = this.contactsService.normalizeSegmentCriteria(
        segment.criteria,
      );

      // Build the where clause with tenant isolation
      const where = this.contactsService.buildWhereForSegment(
        accountId,
        parsed.logic,
        parsed.rules,
      );

      // Count matching contacts
      const count = await this.prisma.contact.count({ where });

      // Update the segment with the new count
      await this.prisma.segment.update({
        where: { id: segmentId },
        data: {
          contactCount: count,
          lastCalculated: new Date(),
        },
      });

      this.logger.log(
        'Successfully recalculated segment ' + segmentId + ', count: ' + count,
      );

      return { success: true, count, segmentId };
    } catch (error) {
      const err = toError(error);
      this.logger.error(
        'Failed to recalculate segment ' + segmentId + ': ' + err.message,
        err.stack,
      );
      throw err;
    }
  }

  @Process({
    name: 'recalculate-account-segments',
    concurrency: 1,
  })
  async handleRecalculateAccountSegments(job: Job<{ accountId: string }>) {
    const { accountId } = job.data;

    this.logger.log('Recalculating all segments for account ' + accountId);

    try {
      // Find all dynamic segments for this account
      const segments = await this.prisma.segment.findMany({
        where: {
          accountId,
          type: 'dynamic',
        },
      });

      const results: Array<{
        segmentId: string;
        count?: number;
        error?: string;
      }> = [];
      for (const segment of segments) {
        try {
          // Parse the criteria
          const parsed = this.contactsService.normalizeSegmentCriteria(
            segment.criteria,
          );

          // Build the where clause with tenant isolation
          const where = this.contactsService.buildWhereForSegment(
            accountId,
            parsed.logic,
            parsed.rules,
          );

          // Count matching contacts
          const count = await this.prisma.contact.count({ where });

          // Update the segment with the new count
          await this.prisma.segment.update({
            where: { id: segment.id },
            data: {
              contactCount: count,
              lastCalculated: new Date(),
            },
          });

          results.push({ segmentId: segment.id, count });
        } catch (error) {
          const err = toError(error);
          this.logger.error(
            `Failed to recalculate segment ${segment.id}: ${err.message}`,
            err.stack,
          );
          results.push({ segmentId: segment.id, error: err.message });
        }
      }

      this.logger.log(
        'Successfully recalculated ' +
          results.length +
          ' segments for account ' +
          accountId,
      );

      return { success: true, results, accountId };
    } catch (error) {
      const err = toError(error);
      this.logger.error(
        'Failed to recalculate account segments for ' +
          accountId +
          ': ' +
          err.message,
        err.stack,
      );
      throw err;
    }
  }
}
