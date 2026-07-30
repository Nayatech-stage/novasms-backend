import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsController — endpoints analytics (US-013)', () => {
  const service = {
    getOverview: jest.fn().mockResolvedValue({ messagesSent: 0 }),
    getSummary: jest.fn().mockResolvedValue({ totalSent: 0 }),
    getActivity: jest.fn().mockResolvedValue([]),
    getCampaignReport: jest.fn().mockResolvedValue({}),
  };

  const req = { accountId: 'acc-1' } as never;

  let controller: AnalyticsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AnalyticsController(
      service as unknown as AnalyticsService,
    );
  });

  it('overview : convertit period en jours (7/30/90)', async () => {
    await controller.overview(req, '90');
    await controller.overview(req, '7');
    await controller.overview(req, 'autre');

    expect(service.getOverview).toHaveBeenNthCalledWith(1, 'acc-1', 90);
    expect(service.getOverview).toHaveBeenNthCalledWith(2, 'acc-1', 7);
    expect(service.getOverview).toHaveBeenNthCalledWith(3, 'acc-1', 30);
  });

  it('summary : période par défaut 30 jours', async () => {
    await controller.summary(req, undefined);

    expect(service.getSummary).toHaveBeenCalledWith('acc-1', 30);
  });

  it('activity : limite parsée depuis la query', async () => {
    await controller.activity(req, '5');

    expect(service.getActivity).toHaveBeenCalledWith('acc-1', 5);
  });

  it('campaignReport : transmet accountId et campaignId', async () => {
    await controller.campaignReport('camp-1', req);

    expect(service.getCampaignReport).toHaveBeenCalledWith('acc-1', 'camp-1');
  });
});
