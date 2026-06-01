import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmailProviderFactory } from './providers/email/email.provider.factory';
import { SmsProviderFactory } from './providers/sms/sms.provider.factory';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: EmailProviderFactory, useValue: { getHealthStatus: () => ({}) } },
        { provide: SmsProviderFactory, useValue: { getHealthStatus: () => ({}) } },
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
