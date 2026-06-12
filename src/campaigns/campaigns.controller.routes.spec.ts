import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { FileUploadService } from './file-upload.service';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';

describe('CampaignsController — routes campagnes (US-007/US-008/US-009)', () => {
  const service = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    duplicateCampaign: jest.fn(),
    deleteCampaign: jest.fn(),
    cancelScheduled: jest.fn(),
    cancelCampaign: jest.fn(),
    saveDraft: jest.fn(),
    sendCampaign: jest.fn(),
    findById: jest.fn(),
    findAccountIdBySegmentId: jest.fn(),
    findFirstAccountId: jest.fn(),
    listAutomationCampaigns: jest.fn(),
    validateSchedule: jest.fn(),
    evaluateABWinner: jest.fn(),
    updateABConfig: jest.fn(),
    getBestSendTime: jest.fn(),
    calculateSmsCost: jest.fn(),
  };

  const fileUploadService = {
    uploadCampaignImage: jest.fn(),
    getCampaignImage: jest.fn(),
    getPresignedGetUrl: jest.fn(),
    getCampaignImages: jest.fn(),
    deleteAllCampaignImages: jest.fn(),
  };

  const emailFactory = {
    getHealthStatus: jest.fn().mockReturnValue({ provider: 'resend' }),
  };
  const smsFactory = {
    getHealthStatus: jest.fn().mockReturnValue({ provider: 'simulation' }),
  };

  const req = { accountId: 'acc-1' } as never;

  let controller: CampaignsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CampaignsController(
      service as unknown as CampaignsService,
      fileUploadService as unknown as FileUploadService,
      emailFactory as unknown as EmailProviderFactory,
      smsFactory as unknown as SmsProviderFactory,
    );
  });

  it('providersHealth expose le statut des providers actifs', () => {
    const health = controller.providersHealth();

    expect(health).toEqual({
      success: true,
      email: { provider: 'resend' },
      sms: { provider: 'simulation' },
    });
  });

  describe('create — résolution du compte', () => {
    it('utilise le tenant de la requête en priorité', async () => {
      service.create.mockResolvedValue({ id: 'camp-1' });

      await controller.create({ channelType: 'EMAIL' }, req);

      expect(service.create).toHaveBeenCalledWith('acc-1', {
        channelType: 'EMAIL',
      });
    });

    it('retombe sur le compte du segment en mode dev sans tenant', async () => {
      service.findAccountIdBySegmentId.mockResolvedValue('acc-from-seg');
      service.create.mockResolvedValue({ id: 'camp-1' });

      await controller.create({ segmentId: 'seg-1' }, {} as never);

      expect(service.findAccountIdBySegmentId).toHaveBeenCalledWith('seg-1');
      expect(service.create).toHaveBeenCalledWith('acc-from-seg', {
        segmentId: 'seg-1',
      });
    });
  });

  it('list transmet filtres et pagination', async () => {
    service.list.mockResolvedValue({ data: [], total: 0 });

    await controller.list(req, 'SENT', 'EMAIL', '2', '10', 'promo');

    expect(service.list).toHaveBeenCalledWith('acc-1', {
      status: 'SENT',
      channel: 'EMAIL',
      page: 2,
      limit: 10,
      search: 'promo',
    });
  });

  it('duplicate / delete / cancelSchedule délèguent au service', async () => {
    service.duplicateCampaign.mockResolvedValue({ id: 'copy' });
    service.deleteCampaign.mockResolvedValue({ success: true });
    service.cancelScheduled.mockResolvedValue({ success: true });

    await controller.duplicate('camp-1', req);
    await controller.delete('camp-1', req);
    await controller.cancelSchedule('camp-1', req);

    expect(service.duplicateCampaign).toHaveBeenCalledWith('acc-1', 'camp-1');
    expect(service.deleteCampaign).toHaveBeenCalledWith('acc-1', 'camp-1');
    expect(service.cancelScheduled).toHaveBeenCalledWith('acc-1', 'camp-1');
  });

  it('listAutomationReady filtre par canal (FIX-C04)', async () => {
    service.listAutomationCampaigns.mockResolvedValue([]);

    await controller.listAutomationReady(req, 'EMAIL');

    expect(service.listAutomationCampaigns).toHaveBeenCalledWith(
      'acc-1',
      'EMAIL',
    );
  });

  it('calculateSmsCost retourne coût et segments SMS (US-008)', () => {
    service.calculateSmsCost.mockReturnValue({ cost: 250, parts: 2 });

    const result = controller.calculateSmsCost({
      text: 'x'.repeat(200),
      recipientCount: 25,
    });

    expect(result).toEqual({ totalCost: 250, parts: 2, segmentCount: 25 });
  });

  describe('images', () => {
    it('getImage renvoie le binaire avec le bon Content-Type', async () => {
      fileUploadService.getCampaignImage.mockResolvedValue({
        buffer: Buffer.from('img'),
        mimeType: 'image/png',
      });
      const res = {
        set: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnValue({ json: jest.fn() }),
      };

      await controller.getImage('photo.png', res as never);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.send).toHaveBeenCalled();
    });

    it('getImage retourne 404 pour une image inconnue', async () => {
      fileUploadService.getCampaignImage.mockRejectedValue(
        new Error('Image not found'),
      );
      const json = jest.fn();
      const res = {
        set: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnValue({ json }),
      };

      await controller.getImage('inconnue.png', res as never);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'Image not found' });
    });

    it('uploadImage vérifie que la campagne appartient au compte', async () => {
      service.get.mockResolvedValue({ id: 'camp-1' });
      fileUploadService.uploadCampaignImage.mockResolvedValue({ id: 'img-1' });
      const file = { originalname: 'a.png' } as never;

      const result = await controller.uploadImage('camp-1', file, req);

      expect(service.get).toHaveBeenCalledWith('acc-1', 'camp-1');
      expect(result).toEqual({ id: 'img-1' });
    });
  });

  describe('sendCampaign', () => {
    const makeRes = () => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      return { res: { status } as never, status, json };
    };

    it('retourne 404 pour une campagne inexistante', async () => {
      service.findById.mockResolvedValue(null);
      const { res, status, json } = makeRes();

      await controller.sendCampaign('camp-x', {}, req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: 'Campagne non trouvée',
      });
    });

    it('envoi immédiat explicite : 201 avec statut SENDING', async () => {
      service.findById.mockResolvedValue({ id: 'camp-1', accountId: 'acc-1' });
      service.sendCampaign.mockResolvedValue({ success: true });
      const { res, status, json } = makeRes();

      await controller.sendCampaign(
        'camp-1',
        { immediateOrScheduled: 'immediate' },
        req,
        res,
      );

      expect(service.sendCampaign).toHaveBeenCalledWith('acc-1', 'camp-1', {
        immediateOrScheduled: 'immediate',
        scheduledAt: undefined,
      });
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, status: 'SENDING' }),
      );
    });

    it('retourne le statut HTTP de l’erreur métier sans fuite technique', async () => {
      service.findById.mockResolvedValue({ id: 'camp-1', accountId: 'acc-1' });
      service.sendCampaign.mockRejectedValue(new Error('prisma timeout'));
      const { res, status, json } = makeRes();

      await controller.sendCampaign('camp-1', {}, req, res);

      expect(status).toHaveBeenCalledWith(500);
      const body = json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).not.toContain('prisma');
    });
  });

  it('saveDraft et cancelCampaign enveloppent les réponses', async () => {
    service.saveDraft.mockResolvedValue({ id: 'camp-1' });
    service.get.mockResolvedValue({ id: 'camp-1', status: 'DRAFT' });
    service.cancelCampaign.mockResolvedValue({ id: 'camp-1' });

    const draft = await controller.saveDraft('camp-1', { name: 'B' }, req);
    const cancel = await controller.cancelCampaign('camp-1', req);

    expect(draft).toMatchObject({ success: true });
    expect(cancel).toMatchObject({ success: true });
  });
});
