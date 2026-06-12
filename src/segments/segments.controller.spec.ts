import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

describe('SegmentsController — routes /segments (US-005)', () => {
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    previewCount: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    refreshCount: jest.fn(),
  };

  const req = { user: { accountId: 'acc-1' } } as never;

  let controller: SegmentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SegmentsController(service as unknown as SegmentsService);
  });

  it('create délègue avec le compte du JWT', () => {
    const body = { name: 'VIP', criteria: { operator: 'AND', filters: [] } };

    controller.create(req, body as never);

    expect(service.create).toHaveBeenCalledWith('acc-1', body);
  });

  it('findAll liste les segments du compte', () => {
    controller.findAll(req);

    expect(service.findAll).toHaveBeenCalledWith('acc-1');
  });

  it('previewCount calcule l’aperçu en temps réel', () => {
    const criteria = { operator: 'OR', filters: [] };

    controller.previewCount(req, criteria as never);

    expect(service.previewCount).toHaveBeenCalledWith('acc-1', criteria);
  });

  it('findOne / update / remove / refresh ciblent le segment du compte', () => {
    controller.findOne(req, 'seg-1');
    controller.update(req, 'seg-1', { name: 'Renommé' } as never);
    controller.remove(req, 'seg-1');
    controller.refresh(req, 'seg-1');

    expect(service.findOne).toHaveBeenCalledWith('acc-1', 'seg-1');
    expect(service.update).toHaveBeenCalledWith('acc-1', 'seg-1', {
      name: 'Renommé',
    });
    expect(service.remove).toHaveBeenCalledWith('acc-1', 'seg-1');
    expect(service.refreshCount).toHaveBeenCalledWith('acc-1', 'seg-1');
  });
});
