import { CampaignStatus, SendStatus, SendVariant } from '@prisma/client';
import { CampaignDispatchProcessor } from './campaign.dispatch.queue';
import { Queue } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignDispatchProcessor evaluate-ab-winner', () => {
  it('picks winner, stores AB results, and dispatches winner to remaining contacts', async () => {
    const prisma = {
      campaign: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'camp-1',
            subjectB: 'Subject B',
            status: CampaignStatus.SENDING,
            abWinner: null,
            sends: [
              {
                status: SendStatus.SENT,
                variant: SendVariant.A,
                openedAt: new Date(),
                clickedAt: new Date(),
              },
              {
                status: SendStatus.SENT,
                variant: SendVariant.A,
                openedAt: null,
                clickedAt: null,
              },
              {
                status: SendStatus.SENT,
                variant: SendVariant.B,
                openedAt: null,
                clickedAt: null,
              },
              {
                status: SendStatus.OPENED,
                variant: SendVariant.B,
                openedAt: new Date(),
                clickedAt: null,
              },
            ],
          })
          .mockResolvedValueOnce({
            id: 'camp-1',
            account: { adminEmail: 'owner@example.com' },
            name: 'Test campaign',
            channelType: 'EMAIL',
          }),
        update: jest.fn().mockResolvedValue({ id: 'camp-1' }),
      },
      aBTestResult: {
        upsert: jest.fn().mockResolvedValue({ id: 'ab-result' }),
      },
      send: {
        count: jest.fn().mockResolvedValue(3),
      },
    } as unknown as PrismaService;

    const dispatchQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    const mailService = {
      sendCampaignSentNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;

    const emailProviderFactory = {
      getProvider: jest.fn(),
    } as unknown as EmailProviderFactory;

    const smsProviderFactory = {
      getProvider: jest.fn(),
    } as unknown as SmsProviderFactory;

    const processor = new CampaignDispatchProcessor(
      prisma,
      dispatchQueue,
      mailService,
      emailProviderFactory,
      smsProviderFactory,
    );

    const response = await processor.process({
      name: 'evaluate-ab-winner',
      data: { campaignId: 'camp-1' },
    } as never);

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        campaignId: 'camp-1',
        winner: 'A',
        remainingCount: 3,
      }),
    );

    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { abWinner: 'A' },
    });
    expect(prisma.aBTestResult.upsert).toHaveBeenCalledTimes(2);
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'dispatch-winner',
      {
        campaignId: 'camp-1',
        variant: 'A',
        remainingContacts: true,
      },
      {
        jobId: 'dispatch-winner-camp-1-A',
        removeOnComplete: true,
      },
    );
  });

  it('marks the campaign as sent when the last dispatch chunk finishes', async () => {
    const prisma = {
      campaign: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'camp-2',
          channelType: 'SMS',
          status: CampaignStatus.SENDING,
          content: 'Hello',
          contentJson: { blocks: [] },
          account: { companyName: 'NovaSMS' },
        }),
        update: jest.fn().mockResolvedValue({ id: 'camp-2' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      send: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'send-1',
            variant: SendVariant.NONE,
            contact: {
              id: 'contact-1',
              email: 'recipient@example.com',
              phone: '+22501020304',
              firstName: 'Romuald',
              optOut: false,
            },
          },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'send-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;

    const dispatchQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    const mailService = {
      sendCampaignSentNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;

    const emailProviderFactory = {
      getProvider: jest.fn(),
    } as unknown as EmailProviderFactory;

    const smsProviderFactory = {
      getProvider: jest.fn().mockReturnValue({
        send: jest.fn().mockResolvedValue({ success: true }),
      }),
    } as unknown as SmsProviderFactory;

    const processor = new CampaignDispatchProcessor(
      prisma,
      dispatchQueue,
      mailService,
      emailProviderFactory,
      smsProviderFactory,
    );

    const response = await processor.process({
      name: 'dispatch-campaign',
      data: { campaignId: 'camp-2' },
    } as never);

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        sent: 1,
        campaignId: 'camp-2',
      }),
    );
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'camp-2' },
      data: { status: CampaignStatus.SENT },
    });
    expect(dispatchQueue.add).not.toHaveBeenCalled();
  });
});
