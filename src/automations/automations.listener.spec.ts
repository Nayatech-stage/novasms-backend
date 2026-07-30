import { ContactAddedListener } from './automations.listener';
import type { AutomationsService } from './automations.service';

describe('ContactAddedListener — déclencheurs événementiels', () => {
  let listener: ContactAddedListener;
  let svc: jest.Mocked<
    Pick<
      AutomationsService,
      | 'scheduleContactAddedAutomations'
      | 'scheduleSegmentJoinedAutomations'
      | 'scheduleCampaignOpenedAutomations'
      | 'scheduleCampaignClickedAutomations'
    >
  >;

  beforeEach(() => {
    svc = {
      scheduleContactAddedAutomations: jest.fn().mockResolvedValue(undefined),
      scheduleSegmentJoinedAutomations: jest.fn().mockResolvedValue(undefined),
      scheduleCampaignOpenedAutomations: jest.fn().mockResolvedValue(undefined),
      scheduleCampaignClickedAutomations: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    listener = new ContactAddedListener(svc as unknown as AutomationsService);
  });

  // ─── contact.added ────────────────────────────────────────────────────────

  it('[contact.added] délègue au service avec le bon payload', async () => {
    const event = { accountId: 'acc-1', contactId: 'c-1' };
    await listener.handleContactAdded(event);
    expect(svc.scheduleContactAddedAutomations).toHaveBeenCalledTimes(1);
    expect(svc.scheduleContactAddedAutomations).toHaveBeenCalledWith(event);
  });

  it('[contact.added] passe le contact enrichi quand il est fourni', async () => {
    const event = {
      accountId: 'acc-1',
      contactId: 'c-1',
      contact: {
        id: 'c-1',
        accountId: 'acc-1',
        email: 'maya@example.com',
        phone: '+2250700000000',
        firstName: 'Maya',
        lastName: 'Dia',
        tags: ['VIP'] as any,
      },
    };
    await listener.handleContactAdded(event);
    expect(svc.scheduleContactAddedAutomations).toHaveBeenCalledWith(event);
  });

  it('[contact.added] ne laisse PAS remonter une erreur du service', async () => {
    svc.scheduleContactAddedAutomations.mockRejectedValueOnce(
      new Error('DB down'),
    );
    await expect(
      listener.handleContactAdded({ accountId: 'acc-1', contactId: 'c-1' }),
    ).resolves.toBeUndefined();
  });

  // ─── segment.joined ───────────────────────────────────────────────────────

  it('[segment.joined] délègue au service avec le bon payload', async () => {
    const event = { accountId: 'acc-1', contactId: 'c-1', segmentId: 'seg-1' };
    await listener.handleSegmentJoined(event);
    expect(svc.scheduleSegmentJoinedAutomations).toHaveBeenCalledTimes(1);
    expect(svc.scheduleSegmentJoinedAutomations).toHaveBeenCalledWith(event);
  });

  it('[segment.joined] ne laisse PAS remonter une erreur du service', async () => {
    svc.scheduleSegmentJoinedAutomations.mockRejectedValueOnce(
      new Error('segment introuvable'),
    );
    await expect(
      listener.handleSegmentJoined({
        accountId: 'acc-1',
        contactId: 'c-1',
        segmentId: 'seg-1',
      }),
    ).resolves.toBeUndefined();
  });

  // ─── campaign.opened ──────────────────────────────────────────────────────

  it('[campaign.opened] délègue au service avec le bon payload', async () => {
    const event = { accountId: 'acc-1', contactId: 'c-1', campaignId: 'cmp-1' };
    await listener.handleCampaignOpened(event);
    expect(svc.scheduleCampaignOpenedAutomations).toHaveBeenCalledTimes(1);
    expect(svc.scheduleCampaignOpenedAutomations).toHaveBeenCalledWith(event);
  });

  it('[campaign.opened] ne laisse PAS remonter une erreur du service', async () => {
    svc.scheduleCampaignOpenedAutomations.mockRejectedValueOnce(
      new Error('campagne introuvable'),
    );
    await expect(
      listener.handleCampaignOpened({
        accountId: 'acc-1',
        contactId: 'c-1',
        campaignId: 'cmp-1',
      }),
    ).resolves.toBeUndefined();
  });

  // ─── campaign.clicked ─────────────────────────────────────────────────────

  it('[campaign.clicked] délègue au service avec le bon payload', async () => {
    const event = { accountId: 'acc-1', contactId: 'c-1', campaignId: 'cmp-1' };
    await listener.handleCampaignClicked(event);
    expect(svc.scheduleCampaignClickedAutomations).toHaveBeenCalledTimes(1);
    expect(svc.scheduleCampaignClickedAutomations).toHaveBeenCalledWith(event);
  });

  it('[campaign.clicked] ne laisse PAS remonter une erreur du service', async () => {
    svc.scheduleCampaignClickedAutomations.mockRejectedValueOnce(
      new Error('provider error'),
    );
    await expect(
      listener.handleCampaignClicked({
        accountId: 'acc-1',
        contactId: 'c-1',
        campaignId: 'cmp-1',
      }),
    ).resolves.toBeUndefined();
  });
});
