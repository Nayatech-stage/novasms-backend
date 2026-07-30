import { SendStatus } from '@prisma/client';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('WebhookService — webhooks Resend / SMS STOP / Stripe (NEW-T03/NEW-T04)', () => {
  const tx = {
    contact: { update: jest.fn() },
    send: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    account: { update: jest.fn() },
    transaction: { create: jest.fn() },
  };

  const prisma = {
    send: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    campaign: { update: jest.fn() },
    contact: { findMany: jest.fn(), updateMany: jest.fn() },
    analytic: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
  };

  const baseSend = {
    id: 'send-1',
    campaignId: 'camp-1',
    contactId: 'ct-1',
    status: SendStatus.SENT,
    openedAt: null,
    clickedAt: null,
    campaign: { accountId: 'acc-1' },
  };

  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookService(
      prisma as unknown as PrismaService,
      {} as unknown as MailService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );
  });

  describe('receiveResendWebhook', () => {
    it('rejette un payload sans sendId', async () => {
      const result = await service.receiveResendWebhook({
        type: 'email.opened',
      });

      expect(result).toMatchObject({
        processed: false,
        reason: 'missing-send-id',
      });
    });

    it('rejette un sendId inconnu', async () => {
      prisma.send.findUnique.mockResolvedValue(null);

      const result = await service.receiveResendWebhook({
        type: 'email.opened',
        data: { sendId: 'send-x' },
      });

      expect(result).toMatchObject({
        processed: false,
        reason: 'send-not-found',
      });
    });

    it('marque Opened et incrémente openedCount sur email.opened', async () => {
      prisma.send.findUnique.mockResolvedValue(baseSend);
      prisma.send.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.receiveResendWebhook({
        type: 'email.opened',
        data: { sendId: 'send-1' },
      });

      expect(result).toMatchObject({ processed: true, sendId: 'send-1' });
      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { openedCount: { increment: 1 } },
      });
      expect(prisma.analytic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'Open' }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('est idempotent quand le send est déjà ouvert (count=0)', async () => {
      prisma.send.findUnique.mockResolvedValue(baseSend);
      prisma.send.updateMany.mockResolvedValue({ count: 0 });

      await service.receiveResendWebhook({
        type: 'email.opened',
        data: { sendId: 'send-1' },
      });

      expect(prisma.campaign.update).not.toHaveBeenCalled();
      expect(prisma.analytic.create).not.toHaveBeenCalled();
    });

    it('traite les bounces : statut BOUNCED + failedCount + analytics Bounce', async () => {
      prisma.send.findUnique.mockResolvedValue(baseSend);
      prisma.send.updateMany.mockResolvedValue({ count: 1 });

      await service.receiveResendWebhook({
        type: 'email.bounced',
        data: { sendId: 'send-1' },
      });

      expect(prisma.send.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SendStatus.BOUNCED }),
        }),
      );
      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { failedCount: { increment: 1 } },
      });
      expect(prisma.analytic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'Bounce' }),
      });
    });

    it('désabonne le contact avec optOutAt sur unsubscribe (RGPD)', async () => {
      prisma.send.findUnique.mockResolvedValue(baseSend);
      prisma.send.updateMany.mockResolvedValue({ count: 1 });

      await service.receiveResendWebhook({
        type: 'email.unsubscribed',
        data: { sendId: 'send-1' },
      });

      const contactUpdate = prisma.contact.updateMany.mock.calls[0][0];
      expect(contactUpdate.where).toEqual({ id: 'ct-1' });
      expect(contactUpdate.data.optOut).toBe(true);
      expect(contactUpdate.data.optOutAt).toBeInstanceOf(Date);
      expect(prisma.analytic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'Unsubscribe' }),
      });
    });
  });

  describe('receiveSmsWebhook — STOP obligatoire (US-008)', () => {
    it('rejette un payload sans téléphone', async () => {
      const result = await service.receiveSmsWebhook('africastalking', {
        event: 'incoming',
      });

      expect(result).toMatchObject({
        processed: false,
        reason: 'missing-phone',
      });
    });

    it('rejette un téléphone inconnu', async () => {
      prisma.contact.findMany.mockResolvedValue([]);

      const result = await service.receiveSmsWebhook('africastalking', {
        phoneNumber: '+2250700000000',
        text: 'STOP',
      });

      expect(result).toMatchObject({
        processed: false,
        reason: 'contact-not-found',
      });
    });

    it('opt-out le contact avec optOutAt quand STOP est reçu', async () => {
      prisma.contact.findMany.mockResolvedValue([
        { id: 'ct-1', accountId: 'acc-1' },
      ]);

      const result = await service.receiveSmsWebhook('africastalking', {
        phoneNumber: '+2250700000000',
        text: 'STOP',
      });

      expect(result).toMatchObject({ processed: true, contacts: 1 });
      const update = tx.contact.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'ct-1' });
      expect(update.data.optOut).toBe(true);
      expect(update.data.optOutAt).toBeInstanceOf(Date);
      expect(tx.send.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: SendStatus.UNSUBSCRIBED },
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalled();
    });

    it('marque les sends BOUNCED sur échec de livraison', async () => {
      prisma.contact.findMany.mockResolvedValue([
        { id: 'ct-1', accountId: 'acc-1' },
      ]);

      await service.receiveSmsWebhook('twilio', {
        status: 'failed',
        phoneNumber: '+2250700000000',
      });

      expect(tx.contact.update).not.toHaveBeenCalled();
      expect(tx.send.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SendStatus.BOUNCED,
            bouncedReason: 'twilio:failed',
          }),
        }),
      );
    });
  });

  describe('receiveStripeWebhook', () => {
    it('rejette un événement sans accountId en metadata', async () => {
      const result = await service.receiveStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', amount_received: 500000 } },
      });

      expect(result).toMatchObject({
        processed: false,
        reason: 'missing-account-id',
      });
    });

    it('crédite le compte et valide la transaction sur succès', async () => {
      const result = await service.receiveStripeWebhook({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_1',
            amount_received: 500000, // centimes → 5000 FCFA
            metadata: { accountId: 'acc-1' },
          },
        },
      });

      expect(result).toMatchObject({
        processed: true,
        accountId: 'acc-1',
        amountFcfa: 5000,
      });
      expect(tx.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { creditBalance: { increment: 5000 } },
      });
      expect(tx.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-1',
          status: 'Validated',
          reference: 'pi_1',
        }),
      });
    });

    it("n'augmente pas le solde sur échec de paiement", async () => {
      await service.receiveStripeWebhook({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_2',
            amount: 500000,
            metadata: { accountId: 'acc-1' },
          },
        },
      });

      expect(tx.account.update).not.toHaveBeenCalled();
      expect(tx.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'Refused' }),
      });
    });
  });
});
