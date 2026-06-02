import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AutomationsService } from './automations.service';
import type { ExecuteAutomationJob } from './automations.types';

export const AUTOMATION_EXECUTE_QUEUE = 'automation-execute';

@Processor(AUTOMATION_EXECUTE_QUEUE)
export class AutomationExecutionProcessor extends WorkerHost {
  constructor(private readonly automationsService: AutomationsService) {
    super();
  }

  async process(job: Job<ExecuteAutomationJob>) {
    try {
      return await this.automationsService.executeQueuedAutomation(job.data);
    } catch (error: unknown) {
      const maxAttempts = job.opts.attempts ?? 1;
      const finalAttemptReached = job.attemptsMade + 1 >= maxAttempts;

      if (finalAttemptReached) {
        await this.automationsService.markExecutionFailed(
          job.data.executionId,
          error instanceof Error
            ? error.message
            : "Impossible d'exécuter l'automatisation.",
        );
      }

      throw error;
    }
  }
}
