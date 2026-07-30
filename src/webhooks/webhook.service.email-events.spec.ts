import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('WebhookService.receiveWebhook — événements email internes (EN-1685)', () => {
  const prisma = {
    campaign: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    contact: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    send: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    analytic: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const mailService = {
    sendCampaignConfirmation: jest.fn().mockResolvedValue(undefined),
  };

  const eventEmitter = { emit: jest.fn() };

  const campaign = {
    id: 'camp-1',
    accountId: 'acc-1',
    name: 'Promo',
    account: { adminEmail: 'admin@novasms.ci' },
  };

  const contact = { id: 'ct-1', email: 'client@x.ci' };

  const payload = (event: string, metadata?: Record<string, unknown>) => ({
    event,
    campaignId: 'camp-1',
    contactId: 'ct-1',
    timestamp: new Date(),
    metadata,
  });

  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.send.updateMany.mockResolvedValue({ count: 1 });
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.contact.findUnique.mockResolvedValue(contact);
    service = new WebhookService(
      prisma as unknown as PrismaService,
      mailService as unknown as MailService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  it('rejette une campagne inconnue', async () => {
    prisma.campaign.findUnique.mockResolvedValue(null);

    await expect(
      service.receiveWebhook(payload('email.sent') as never),
    ).rejects.toThrow('Campaign not found');
  });

  it('rejette un contact inconnu', async () => {
    prisma.contact.findUnique.mockResolvedValue(null);

    await expect(
      service.receiveWebhook(payload('email.opened') as never),
    ).rejects.toThrow('Contact not found');
  });

  it('email.sent : marque SENT, incrémente sentCount et notifie l’admin', async () => {
    const result = await service.receiveWebhook(payload('email.sent') as never);

    expect(result.processed).toBe(true);
    expect(prisma.send.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { sentCount: { increment: 1 } },
    });
    expect(mailService.sendCampaignConfirmation).toHaveBeenCalledWith(
      'admin@novasms.ci',
      expect.objectContaining({ campaignName: 'Promo' }),
    );
  });

  it('email.opened : analytics Open + événement campaign.opened', async () => {
    await service.receiveWebhook(payload('email.opened') as never);

    expect(prisma.analytic.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'Open' }),
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'campaign.opened',
      expect.objectContaining({ campaignId: 'camp-1', contactId: 'ct-1' }),
    );
  });

  it('email.clicked : analytics Click + événement campaign.clicked', async () => {
    await service.receiveWebhook(payload('email.clicked') as never);

    expect(prisma.analytic.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'Click' }),
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'campaign.clicked',
      expect.anything(),
    );
  });

  describe('email.bounced — classification US-007', () => {
    it('hard bounce : BOUNCED + failedCount + opt-out RGPD', async () => {
      await service.receiveWebhook(
        payload('email.bounced', {
          reason: 'hard_bounce_user_unknown',
        }) as never,
      );

      expect(prisma.send.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'BOUNCED',
            bouncedReason: expect.stringContaining('HARD'),
          }),
        }),
      );
      const update = prisma.contact.update.mock.calls[0][0];
      expect(update.data.optOut).toBe(true);
      expect(update.data.optOutAt).toBeInstanceOf(Date);
    });

    it('soft bounce : BOUNCED sans opt-out', async () => {
      await service.receiveWebhook(
        payload('email.bounced', { reason: 'soft_mailbox_full' }) as never,
      );

      expect(prisma.send.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bouncedReason: expect.stringContaining('SOFT'),
          }),
        }),
      );
      expect(prisma.contact.update).not.toHaveBeenCalled();
    });

    it('plainte spam : opt-out immédiat', async () => {
      await service.receiveWebhook(
        payload('email.bounced', { reason: 'complaint' }) as never,
      );

      expect(prisma.contact.update).toHaveBeenCalled();
    });
  });

  it('getCampaignWebhooks expose les compteurs de la campagne', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      sentCount: 10,
      openedCount: 4,
    });

    const stats = await service.getCampaignWebhooks('camp-1');

    expect(stats).toMatchObject({ sentCount: 10, openedCount: 4 });
  });
});
