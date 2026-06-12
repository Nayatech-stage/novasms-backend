import * as fs from 'fs';
import { join } from 'path';
import { FileUploadService } from './file-upload.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FileUploadService — images de campagne (stockage local)', () => {
  const originalEnv = process.env;
  const uploadDir = join(process.cwd(), 'uploads', 'campaigns');
  const createdFiles: string[] = [];

  const prisma = {
    campaignImage: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const makeService = () => {
    process.env = { ...originalEnv, CAMPAIGN_IMAGE_STORAGE_PROVIDER: 'local' };
    return new FileUploadService(prisma as unknown as PrismaService);
  };

  const makeFile = (overrides: Partial<Express.Multer.File> = {}) =>
    ({
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('fake-png-bytes'),
      ...overrides,
    }) as Express.Multer.File;

  afterEach(() => {
    process.env = originalEnv;
    for (const f of createdFiles.splice(0)) {
      try {
        fs.unlinkSync(f);
      } catch {
        // déjà supprimé par le test
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.campaignImage.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'img-1',
        uploadedAt: new Date(),
        ...data,
      }),
    );
  });

  describe('uploadCampaignImage — validations', () => {
    it('refuse un fichier absent', async () => {
      const service = makeService();

      await expect(
        service.uploadCampaignImage('camp-1', undefined as never),
      ).rejects.toThrow('No file provided');
    });

    it('refuse un fichier de plus de 5 Mo', async () => {
      const service = makeService();

      await expect(
        service.uploadCampaignImage(
          'camp-1',
          makeFile({ size: 6 * 1024 * 1024 }),
        ),
      ).rejects.toThrow('File too large');
    });

    it('refuse un type MIME non-image (anti-upload exécutable)', async () => {
      const service = makeService();

      await expect(
        service.uploadCampaignImage(
          'camp-1',
          makeFile({ mimetype: 'application/x-sh', originalname: 'evil.sh' }),
        ),
      ).rejects.toThrow('Invalid file type');
    });

    it('écrit le fichier localement sous un nom UUID et enregistre les métadonnées', async () => {
      const service = makeService();

      const result = await service.uploadCampaignImage('camp-1', makeFile());

      // Nom de fichier UUID — jamais le nom d'origine (anti path traversal)
      const storedName = result.url.split('/').pop() as string;
      expect(storedName).toMatch(/^[0-9a-f-]{36}\.png$/i);
      const storedPath = join(uploadDir, storedName);
      createdFiles.push(storedPath);
      expect(fs.existsSync(storedPath)).toBe(true);

      expect(prisma.campaignImage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp-1',
          fileName: 'photo.png',
          mimeType: 'image/png',
        }),
      });
      expect(result.id).toBe('img-1');
    });
  });

  describe('getCampaignImage / deleteCampaignImage (local)', () => {
    it('relit une image stockée avec son type MIME', async () => {
      const service = makeService();
      prisma.campaignImage.findFirst.mockResolvedValue({
        mimeType: 'image/png',
      });

      const uploaded = await service.uploadCampaignImage('camp-1', makeFile());
      const storedName = uploaded.url.split('/').pop() as string;
      createdFiles.push(join(uploadDir, storedName));

      const image = await service.getCampaignImage(storedName);

      expect(image.buffer.toString()).toBe('fake-png-bytes');
      expect(image.mimeType).toBe('image/png');
    });

    it('lève une erreur pour une image inexistante', async () => {
      const service = makeService();

      await expect(service.getCampaignImage('inexistante.png')).rejects.toThrow(
        'Image not found',
      );
    });

    it('supprime le fichier local', async () => {
      const service = makeService();
      const uploaded = await service.uploadCampaignImage('camp-1', makeFile());
      const storedName = uploaded.url.split('/').pop() as string;
      const storedPath = join(uploadDir, storedName);

      await service.deleteCampaignImage(storedName);

      expect(fs.existsSync(storedPath)).toBe(false);
    });
  });

  describe('getCampaignImages', () => {
    it('normalise les URLs relatives en URLs absolues', async () => {
      const service = makeService();
      prisma.campaignImage.findMany.mockResolvedValue([
        {
          id: 'img-1',
          fileName: 'a.png',
          fileSize: 10,
          mimeType: 'image/png',
          storageUrl: 'https://cdn.x/a.png',
          uploadedAt: new Date(),
        },
        {
          id: 'img-2',
          fileName: 'b.png',
          fileSize: 10,
          mimeType: 'image/png',
          storageUrl: '/api/campaigns/images/b.png',
          uploadedAt: new Date(),
        },
      ]);

      const images = await service.getCampaignImages('camp-1');

      expect(images[0].storageUrl).toBe('https://cdn.x/a.png');
      expect(images[1].storageUrl).toMatch(/^http/);
      expect(images[1].storageUrl).toContain('/campaigns/images/b.png');
    });
  });
});
