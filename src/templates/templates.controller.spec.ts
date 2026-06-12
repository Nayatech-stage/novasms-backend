import { Test, TestingModule } from '@nestjs/testing';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

const mockTemplatesService = {
  create: jest.fn().mockResolvedValue({ id: 't-1' }),
  findAll: jest.fn().mockResolvedValue([{ id: 't-1' }]),
  findByKey: jest.fn().mockResolvedValue({ id: 't-1', key: 'welcome' }),
  findOne: jest.fn().mockResolvedValue({
    id: 't-1',
    htmlContent: '<p>Bonjour {{ prenom }}</p>',
    contentText: 'Bonjour {{ prenom }}',
  }),
  update: jest.fn().mockResolvedValue({ id: 't-1', name: 'maj' }),
  remove: jest.fn().mockResolvedValue({ deleted: true }),
};

describe('TemplatesController', () => {
  let controller: TemplatesController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [
        { provide: TemplatesService, useValue: mockTemplatesService },
      ],
    }).compile();

    controller = module.get(TemplatesController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('create délègue au service', async () => {
    const body = { name: 'Bienvenue', type: 'EMAIL' };
    await expect(controller.create(body as never)).resolves.toEqual({
      id: 't-1',
    });
    expect(mockTemplatesService.create).toHaveBeenCalledWith(body);
  });

  it('findAll retourne la liste', async () => {
    await expect(controller.findAll()).resolves.toEqual([{ id: 't-1' }]);
  });

  it('findByKey passe la clé au service', async () => {
    await controller.findByKey('welcome');
    expect(mockTemplatesService.findByKey).toHaveBeenCalledWith('welcome');
  });

  it('findOne passe l’id au service', async () => {
    await controller.findOne('t-1');
    expect(mockTemplatesService.findOne).toHaveBeenCalledWith('t-1');
  });

  it('update délègue id + body', async () => {
    await controller.update('t-1', { name: 'maj' } as never);
    expect(mockTemplatesService.update).toHaveBeenCalledWith('t-1', {
      name: 'maj',
    });
  });

  it('remove délègue au service', async () => {
    await controller.remove('t-1');
    expect(mockTemplatesService.remove).toHaveBeenCalledWith('t-1');
  });

  it('preview remplace les variables dans html et texte', async () => {
    const result = await controller.preview('t-1', { prenom: 'Awa' });
    expect(result).toEqual({
      html: '<p>Bonjour Awa</p>',
      text: 'Bonjour Awa',
    });
  });

  it('preview gère un template sans contenu et vars absentes', async () => {
    mockTemplatesService.findOne.mockResolvedValueOnce({
      id: 't-2',
      htmlContent: null,
      contentText: null,
    });
    const result = await controller.preview(
      't-2',
      undefined as unknown as Record<string, unknown>,
    );
    expect(result).toEqual({ html: '', text: '' });
  });

  it('preview remplace une variable null par chaîne vide', async () => {
    const result = await controller.preview('t-1', { prenom: null });
    expect(result).toEqual({ html: '<p>Bonjour </p>', text: 'Bonjour ' });
  });
});
