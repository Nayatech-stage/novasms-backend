import { CampaignStatus, SendVariant } from '@prisma/client';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService A/B flow', () => {
  const previousTestRecipient = process.env.RESEND_TEST_RECIPIENT;

  beforeAll(() => {
    delete process.env.RESEND_TEST_RECIPIENT;
  });

  afterAll(() => {
    if (previousTestRecipient === undefined) {
      delete process.env.RESEND_TEST_RECIPIENT;
    } else {
      process.env.RESEND_TEST_RECIPIENT = previousTestRecipient;
    }
  });

  it('creates pending A/B sends and enqueues initial + evaluation jobs', async () => {
    const prisma = {
      campaign: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'camp-1',
          accountId: 'acc-1',
          segmentId: 'seg-1',
          channelType: 'EMAIL',
          subjectB: 'Variant B subject',
          abSplitPct: 50,
          abTestDuration: 4,
        }),
        update: jest.fn().mockResolvedValue({ id: 'camp-1' }),
      },
      contact: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 10 }).map((_, index) => ({
            id: `contact-${index + 1}`,
            email: `c${index + 1}@example.com`,
            phone: null,
            firstName: `Name${index + 1}`,
            lastName: 'Test',
          })),
        ),
      },
      send: {
        createMany: jest.fn().mockResolvedValue({ count: 10 }),
      },
    };

    const dispatchQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };
    const scheduleQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };
    const contactsService = {
      getSegmentContactsForCampaign: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }).map((_, index) => ({
          id: `contact-${index + 1}`,
          email: `c${index + 1}@example.com`,
          phone: null,
          firstName: `Name${index + 1}`,
          lastName: 'Test',
        })),
      ),
    };

    const service = new CampaignsService(
      prisma,
      contactsService,
      dispatchQueue,
      scheduleQueue,
    );

    const result = await service.sendCampaign('acc-1', 'camp-1', {
      immediateOrScheduled: 'immediate',
    });

    expect(result.success).toBe(true);
    expect(contactsService.getSegmentContactsForCampaign).toHaveBeenCalledWith(
      'acc-1',
      'seg-1',
    );
    expect(prisma.send.createMany).toHaveBeenCalledTimes(1);

    const payload = prisma.send.createMany.mock.calls[0][0];
    const variants = payload.data.map((row) => row.variant);

    expect(variants.filter((v) => v === SendVariant.A)).toHaveLength(2);
    expect(variants.filter((v) => v === SendVariant.B)).toHaveLength(3);
    expect(variants.filter((v) => v === SendVariant.NONE)).toHaveLength(5);

    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: {
        status: CampaignStatus.SENDING,
        scheduledAt: null,
        sentCount: 0,
        failedCount: 0,
        abWinner: null,
      },
    });

    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'dispatch-campaign',
      { campaignId: 'camp-1', variant: 'A', chunkSize: 500, cursor: null },
      {
        jobId: 'dispatch-camp-1-A-initial',
        removeOnComplete: true,
      },
    );
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'dispatch-campaign',
      { campaignId: 'camp-1', variant: 'B', chunkSize: 500, cursor: null },
      {
        jobId: 'dispatch-camp-1-B-initial',
        removeOnComplete: true,
      },
    );
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'evaluate-ab-winner',
      { campaignId: 'camp-1' },
      expect.objectContaining({
        jobId: 'evaluate-ab-camp-1',
        removeOnComplete: true,
      }),
    );

    expect(scheduleQueue.add).not.toHaveBeenCalled();
  });
});
