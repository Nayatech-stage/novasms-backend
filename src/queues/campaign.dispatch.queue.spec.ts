import { CampaignStatus, SendStatus, SendVariant } from '@prisma/client';
import { CampaignDispatchProcessor } from './campaign.dispatch.queue';
import { Queue } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignDispatchProcessor evaluate-ab-winner', () => {
  const originalEnv = process.env;

  afterAll(() => {
    process.env = originalEnv;
  });

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
              phone: '+225 01 02 03 04',
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
    const smsProvider = smsProviderFactory.getProvider();
    expect(smsProvider.send).toHaveBeenCalledWith('+22501020304', 'Hello');
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'camp-2' },
      data: { status: CampaignStatus.SENT },
    });
    expect(dispatchQueue.add).not.toHaveBeenCalled();
  });

  it('rewrites local campaign image urls to the public storage base for email sends', async () => {
    process.env = {
      ...originalEnv,
      S3_ENDPOINT: 'https://storage-staging.novasms.com',
      CAMPAIGN_IMAGE_BUCKET: 'campaigns',
    };

    const prisma = {
      campaign: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'camp-3',
          channelType: 'EMAIL',
          status: CampaignStatus.SENDING,
          subject: '{{prénom}} - Promo spéciale',
          content: '',
          contentJson: {
            blocks: [
              {
                type: 'image',
                content: {
                  src: 'http://localhost:9000/campaigns/banner.png',
                  alt: 'Banner',
                },
              },
              {
                type: 'html',
                content: {
                  html: '<div><img src="/campaigns/footer.png" alt="Footer" /></div>',
                },
              },
            ],
          },
          account: { companyName: 'NovaSMS' },
        }),
        update: jest.fn().mockResolvedValue({ id: 'camp-3' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      send: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'send-3',
            variant: SendVariant.NONE,
            contact: {
              id: 'contact-3',
              email: 'recipient@example.com',
              phone: null,
              firstName: 'Maya',
              optOut: false,
            },
          },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'send-3' }),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;

    const dispatchQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    const mailService = {
      sendCampaignSentNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;

    const emailSend = jest.fn().mockResolvedValue({ success: true });
    const emailProviderFactory = {
      getProvider: jest.fn(() => ({ send: emailSend })),
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
      name: 'dispatch-campaign',
      data: { campaignId: 'camp-3' },
    } as never);

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        sent: 1,
        campaignId: 'camp-3',
      }),
    );
    expect(emailSend).toHaveBeenCalledTimes(1);
    const [, subject, html] = emailSend.mock.calls[0];
    expect(subject).toBe('Maya - Promo spéciale');
    expect(html).toContain(
      'https://storage-staging.novasms.com/campaigns/banner.png',
    );
    expect(html).toContain(
      'https://storage-staging.novasms.com/campaigns/footer.png',
    );
  });
});
