// @ts-nocheck
import { CampaignStatus } from '@prisma/client';
import { CampaignScheduleWorker } from './campaign.schedule.worker';

describe('CampaignScheduleWorker', () => {
  it('re-enqueues overdue scheduled campaigns and marks them as sending', async () => {
    const scheduleQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const prisma = {
      campaign: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'campaign-1',
            accountId: 'account-1',
            channelType: 'EMAIL',
            estimatedCost: 0,
            scheduledAt: new Date(Date.now() - 10 * 60 * 1000),
            status: CampaignStatus.SCHEDULED,
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue({ creditBalance: 100 }),
      },
    };

    const worker = new CampaignScheduleWorker(prisma, scheduleQueue);

    await worker.handleScheduledCampaigns();

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: CampaignStatus.SCHEDULED,
          scheduledAt: { lte: expect.any(Date) },
        },
        orderBy: { scheduledAt: 'asc' },
      }),
    );
    expect(scheduleQueue.add).toHaveBeenCalledWith(
      'trigger-campaign',
      {
        campaignId: 'campaign-1',
        accountId: 'account-1',
        channelType: 'EMAIL',
      },
      {
        jobId: 'sched-campaign-1',
        removeOnComplete: true,
      },
    );
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { status: CampaignStatus.SENDING },
    });
  });
});