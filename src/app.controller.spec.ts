import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmailProviderFactory } from './providers/email/email.provider.factory';
import { SmsProviderFactory } from './providers/sms/sms.provider.factory';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: EmailProviderFactory,
          useValue: { getHealthStatus: () => ({}) },
        },
        {
          provide: SmsProviderFactory,
          useValue: { getHealthStatus: () => ({}) },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return welcome message', () => {
      expect(appController.getWelcome()).toBe('Bienvenue sur NovaSMS API v1.0');
    });
  });
});
