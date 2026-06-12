import { SegmentRecalculationService } from './segment.recalculation.service';
import type { Queue } from 'bull';

describe('SegmentRecalculationService — file de recalcul (EN-1652)', () => {
  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: jest.fn(),
  };

  let service: SegmentRecalculationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SegmentRecalculationService(queue as unknown as Queue);
  });

  it('enfile un recalcul de segment ciblé', async () => {
    await service.addRecalculateSegmentJob('seg-1', 'acc-1');

    expect(queue.add).toHaveBeenCalledWith('recalculate-segment', {
      segmentId: 'seg-1',
      accountId: 'acc-1',
    });
  });

  it('enfile un recalcul global du compte', async () => {
    await service.addRecalculateAccountSegmentsJob('acc-1');

    expect(queue.add).toHaveBeenCalledWith('recalculate-account-segments', {
      accountId: 'acc-1',
    });
  });

  it('getJobStatus retourne null pour un job inconnu', async () => {
    queue.getJob.mockResolvedValue(null);

    expect(await service.getJobStatus('job-x')).toBeNull();
  });

  it('getJobStatus expose état et progression', async () => {
    queue.getJob.mockResolvedValue({
      id: 'job-1',
      getState: jest.fn().mockResolvedValue('completed'),
      progress: 100,
      data: { segmentId: 'seg-1' },
      finishedOn: 123,
      processedOn: 100,
    });

    const status = await service.getJobStatus('job-1');

    expect(status).toMatchObject({
      id: 'job-1',
      status: 'completed',
      progress: 100,
    });
  });
});
