import { BadRequestException } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

describe('AutomationsController — CRUD automatisations (US-011/NEW-S401)', () => {
  const service = {
    createAutomation: jest.fn(),
    listAutomations: jest.fn(),
    getAutomation: jest.fn(),
    updateAutomation: jest.fn(),
    toggleAutomation: jest.fn(),
    triggerAutomationForContact: jest.fn(),
    deleteAutomation: jest.fn(),
    getAutomationReport: jest.fn(),
  };

  let controller: AutomationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AutomationsController(
      service as unknown as AutomationsService,
    );
  });

  it('rejette toutes les routes sans accountId (multi-tenant strict)', async () => {
    await expect(
      controller.create(null, { name: 'X' } as never),
    ).rejects.toThrow(BadRequestException);
    await expect(controller.list(null)).rejects.toThrow(BadRequestException);
    await expect(controller.detail(null, 'a-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.remove(null, 'a-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create délègue au service avec le compte', async () => {
    service.createAutomation.mockResolvedValue({ id: 'auto-1' });

    const result = await controller.create('acc-1', {
      name: 'Bienvenue',
      trigger: 'contact_added',
      channel: 'Email',
    } as never);

    expect(result).toEqual({ id: 'auto-1' });
    expect(service.createAutomation).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ name: 'Bienvenue' }),
    );
  });

  it('list enveloppe les résultats dans data', async () => {
    service.listAutomations.mockResolvedValue([{ id: 'auto-1' }]);

    const result = await controller.list('acc-1');

    expect(result).toEqual({ data: [{ id: 'auto-1' }] });
  });

  it('toggle active/désactive via le service', async () => {
    service.toggleAutomation.mockResolvedValue({
      id: 'auto-1',
      status: 'Active',
    });

    const result = await controller.toggle('acc-1', 'auto-1');

    expect(result.status).toBe('Active');
    expect(service.toggleAutomation).toHaveBeenCalledWith('acc-1', 'auto-1');
  });

  it('trigger transmet contactId et délai', async () => {
    service.triggerAutomationForContact.mockResolvedValue({ id: 'exec-1' });

    await controller.trigger('acc-1', 'auto-1', {
      contactId: 'ct-1',
      delaySeconds: 60,
    });

    expect(service.triggerAutomationForContact).toHaveBeenCalledWith(
      'acc-1',
      'auto-1',
      'ct-1',
      60,
    );
  });

  it('report délègue au service', async () => {
    service.getAutomationReport.mockResolvedValue({ totalExecutions: 3 });

    const result = await controller.report('acc-1', 'auto-1');

    expect(result).toEqual({ totalExecutions: 3 });
  });
});
