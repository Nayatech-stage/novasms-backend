const { CampaignsController } = require('./campaigns.controller');
import type { CampaignsService } from './campaigns.service';
import type { FileUploadService } from './file-upload.service';
import type { EmailProviderFactory } from '../providers/email/email.provider.factory';
import type { SmsProviderFactory } from '../providers/sms/sms.provider.factory';

describe('CampaignsController providersHealth', () => {
  it('returns the active email and sms provider health status without sending anything', async () => {
    const campaignsService = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      deleteCampaign: jest.fn(),
      cancelScheduled: jest.fn(),
      evaluateABWinner: jest.fn(),
      updateABConfig: jest.fn(),
      getBestSendTime: jest.fn(),
      calculateSmsCost: jest.fn(),
      sendCampaign: jest.fn(),
      saveDraft: jest.fn(),
      cancelCampaign: jest.fn(),
    } as unknown as CampaignsService;

    const fileUploadService = {
      uploadCampaignImage: jest.fn(),
      getCampaignImage: jest.fn(),
      getCampaignImages: jest.fn(),
      deleteAllCampaignImages: jest.fn(),
    } as unknown as FileUploadService;

    const emailProviderFactory = {
      getHealthStatus: jest.fn().mockReturnValue({
        providerType: 'email',
        primary: 'resend',
        secondary: 'brevo',
        config: {
          resendApiKeyConfigured: true,
          brevoApiKeyConfigured: false,
        },
      }),
    } as unknown as EmailProviderFactory;

    const smsProviderFactory = {
      getHealthStatus: jest.fn().mockReturnValue({
        providerType: 'sms',
        primary: 'twilio',
        secondary: 'africastalking',
        config: {
          twilioConfigured: true,
          africastalkingConfigured: false,
        },
      }),
    } as unknown as SmsProviderFactory;

    const controller = new CampaignsController(
      campaignsService,
      fileUploadService,
      emailProviderFactory,
      smsProviderFactory,
    );

    const result = await controller.providersHealth();

    expect(result).toEqual({
      success: true,
      email: {
        providerType: 'email',
        primary: 'resend',
        secondary: 'brevo',
        config: {
          resendApiKeyConfigured: true,
          brevoApiKeyConfigured: false,
        },
      },
      sms: {
        providerType: 'sms',
        primary: 'twilio',
        secondary: 'africastalking',
        config: {
          twilioConfigured: true,
          africastalkingConfigured: false,
        },
      },
    });

    expect(emailProviderFactory.getHealthStatus).toHaveBeenCalledTimes(1);
    expect(smsProviderFactory.getHealthStatus).toHaveBeenCalledTimes(1);
  });
});

describe('CampaignsController presign endpoint', () => {
  it('returns a presigned url when available', async () => {
    const fileUploadService = {
      getPresignedGetUrl: jest
        .fn()
        .mockResolvedValue('https://signed.url/image.png'),
    } as unknown as FileUploadService;

    const controller = new CampaignsController({}, fileUploadService, {}, {});

    const res = await controller.presignImage('image.png', '600');
    expect(fileUploadService.getPresignedGetUrl).toHaveBeenCalledWith(
      'image.png',
      600,
    );
    expect(res).toEqual({ url: 'https://signed.url/image.png', expires: 600 });
  });

  it('throws when presign is not available', async () => {
    const fileUploadService = {
      getPresignedGetUrl: jest.fn().mockResolvedValue(null),
    } as unknown as FileUploadService;

    const controller = new CampaignsController({}, fileUploadService, {}, {});

    await expect(controller.presignImage('image.png')).rejects.toBeTruthy();
    expect(fileUploadService.getPresignedGetUrl).toHaveBeenCalledWith(
      'image.png',
      3600,
    );
  });
});
