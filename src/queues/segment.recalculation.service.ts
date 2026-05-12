/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

@Injectable()
export class SegmentRecalculationService {
  constructor(
    @InjectQueue('segment-recalculation')
    private segmentRecalculationQueue: Queue,
  ) {}

  async addRecalculateSegmentJob(segmentId: string, accountId: string) {
    return await this.segmentRecalculationQueue.add('recalculate-segment', {
      segmentId,
      accountId,
    });
  }

  async addRecalculateAccountSegmentsJob(accountId: string) {
    return await this.segmentRecalculationQueue.add(
      'recalculate-account-segments',
      {
        accountId,
      },
    );
  }

  async getJobStatus(jobId: string) {
    const job = await this.segmentRecalculationQueue.getJob(jobId);
    if (!job) return null;

    return {
      id: job.id,
      status: await job.getState(),
      progress: job.progress,
      data: job.data,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }
}
