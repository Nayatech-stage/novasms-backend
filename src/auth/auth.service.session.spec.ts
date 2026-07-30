import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';

const mockPrisma = {
  account: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('signed-token'),
  verify: jest.fn(),
};

const mockMail = {
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendTwoFactorCodeEmail: jest.fn().mockResolvedValue(undefined),
};

const baseAccount = {
  id: 'acc-1',
  adminEmail: 'admin@novasms.ci',
  companyName: 'Boutique',
  sector: null,
  primaryChannels: [],
  onboardingCompleted: true,
  twoFactorSecret: null,
  backupCodes: [],
};

const primaryUser = {
  id: 'user-1',
  email: 'admin@novasms.ci',
  accountId: 'acc-1',
  role: 'Admin',
  twoFactorEnabled: true,
};

describe('AuthService — sessions, refresh et 2FA (US-002 / EN-1635 / EN-1641)', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: MailService, useValue: mockMail },
        {
          provide: SmsProviderFactory,
          useValue: {
            getProvider: () => ({
              send: jest.fn().mockResolvedValue({ success: true }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwt.sign.mockReturnValue('signed-token');
  });

  describe('refreshTokens — rotation (EN-1635)', () => {
    it('rejette un appel sans token', async () => {
      await expect(service.refreshTokens('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un token invalide ou expiré', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshTokens('vieux-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejette si l'email du token ne correspond plus au compte", async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'acc-1',
        email: 'ancien@novasms.ci',
      });
      mockPrisma.account.findUnique.mockResolvedValue(baseAccount);

      await expect(service.refreshTokens('token')).rejects.toThrow(
        'Compte introuvable pour ce token',
      );
    });

    it('émet une nouvelle paire access/refresh pour un token valide', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'acc-1',
        email: 'admin@novasms.ci',
      });
      mockPrisma.account.findUnique.mockResolvedValue(baseAccount);
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);

      const result = await service.refreshTokens('refresh-valide');

      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // access + refresh signés
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetPassword (US-002)', () => {
    it('rejette sans token', async () => {
      await expect(service.resetPassword('', 'nouveau-mdp')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un token expiré', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('token-expire', 'nouveau-mdp'),
      ).rejects.toThrow('Token invalide ou expiré');
    });

    it('réinitialise le mot de passe et déverrouille le compte', async () => {
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.resetPassword('token-ok', 'nouveau-mdp-8c');

      expect(result.success).toBe(true);
      const data = mockPrisma.account.update.mock.calls[0][0].data;
      expect(data.passwordHash).not.toBe('nouveau-mdp-8c');
      expect(data.resetPasswordToken).toBeNull();
      expect(data.loginAttempts).toBe(0);
      expect(data.lockedUntil).toBeNull();
    });
  });

  describe('verifyTwoFactor (EN-1641)', () => {
    it('rejette sans token ou sans code', async () => {
      await expect(service.verifyTwoFactor('', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un token 2FA au mauvais purpose', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'acc-1', purpose: 'login' });

      await expect(service.verifyTwoFactor('token', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepte un code TOTP valide et reset les compteurs de blocage', async () => {
      const secret = speakeasy.generateSecret({ length: 20 }).base32;
      const code = speakeasy.totp({ secret, encoding: 'base32' });

      mockJwt.verify.mockReturnValue({ sub: 'acc-1', purpose: 'two-factor' });
      mockPrisma.account.findUnique.mockResolvedValue({
        ...baseAccount,
        twoFactorSecret: secret,
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.verifyTwoFactor('token-2fa', code);

      expect(result.success).toBe(true);
      const data = mockPrisma.account.update.mock.calls[0][0].data;
      expect(data.loginAttempts).toBe(0);
      expect(data.lockedUntil).toBeNull();
    });

    it('consomme un code de secours à usage unique', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'acc-1', purpose: 'two-factor' });
      mockPrisma.account.findUnique.mockResolvedValue({
        ...baseAccount,
        backupCodes: ['1111-2222', '3333-4444'],
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.verifyTwoFactor('token-2fa', '1111-2222');

      expect(result.success).toBe(true);
      const data = mockPrisma.account.update.mock.calls[0][0].data;
      expect(data.backupCodes).toEqual(['3333-4444']);
    });

    it('rejette un code incorrect', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'acc-1', purpose: 'two-factor' });
      mockPrisma.account.findUnique.mockResolvedValue({
        ...baseAccount,
        twoFactorSecret: speakeasy.generateSecret({ length: 20 }).base32,
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);

      await expect(
        service.verifyTwoFactor('token-2fa', '000000'),
      ).rejects.toThrow('Code de vérification incorrect');
    });
  });

  describe('enable/disable 2FA', () => {
    it('enableTwoFactor valide le code TOTP et génère 10 codes de secours', async () => {
      const secret = speakeasy.generateSecret({ length: 20 }).base32;
      const code = speakeasy.totp({ secret, encoding: 'base32' });

      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'admin@novasms.ci',
        twoFactorSecret: secret,
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.account.update.mockResolvedValue({});

      const result = (await service.enableTwoFactor('acc-1', code)) as {
        success: boolean;
        backup_codes: string[];
      };

      expect(result.success).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { email: 'admin@novasms.ci' },
        data: { twoFactorEnabled: true },
      });
      const backupCodes =
        mockPrisma.account.update.mock.calls[0][0].data.backupCodes;
      expect(backupCodes).toHaveLength(10);
    });

    it('enableTwoFactor rejette un code TOTP invalide', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'admin@novasms.ci',
        twoFactorSecret: speakeasy.generateSecret({ length: 20 }).base32,
      });

      await expect(service.enableTwoFactor('acc-1', '000000')).rejects.toThrow(
        'Code invalide',
      );
    });

    it('disableTwoFactor purge secret et codes de secours', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'admin@novasms.ci',
        twoFactorSecret: 'SECRET',
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.disableTwoFactor('acc-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: {
          twoFactorSecret: null,
          twoFactorEnabled: false,
          twoFactorPhone: null,
          backupCodes: [],
          twoFactorCode: null,
          twoFactorCodeExpiry: null,
        },
      });
    });
  });

  describe('markOnboardingCompleted', () => {
    it('marque le compte comme onboardé', async () => {
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.markOnboardingCompleted('acc-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { onboardingCompleted: true },
      });
    });
  });

  describe('sendTwoFactorSms', () => {
    it('génère un code à 6 chiffres avec expiration 10 min', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(baseAccount);
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.sendTwoFactorSms('acc-1');

      expect(result.success).toBe(true);
      const data = mockPrisma.account.update.mock.calls[0][0].data;
      expect(data.twoFactorCode).toMatch(/^\d{6}$/);
      const tenMinutes = 10 * 60 * 1000;
      expect(
        Math.abs(
          data.twoFactorCodeExpiry.getTime() - (Date.now() + tenMinutes),
        ),
      ).toBeLessThan(5000);
    });
  });

  describe('resendConfirmationEmail (US-001)', () => {
    it('rejette sans email', async () => {
      await expect(service.resendConfirmationEmail('')).rejects.toThrow(
        'Email missing',
      );
    });

    it('rejette un compte inconnu', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      await expect(
        service.resendConfirmationEmail('inconnu@x.ci'),
      ).rejects.toThrow('Account not found');
    });

    it('ne renvoie rien si l’email est déjà vérifié', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        ...baseAccount,
        emailVerified: true,
      });

      const result = await service.resendConfirmationEmail('admin@novasms.ci');

      expect(result.message).toContain('already verified');
      expect(mockMail.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('régénère un token 24h et renvoie l’email de vérification', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        ...baseAccount,
        emailVerified: false,
      });
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.resendConfirmationEmail('admin@novasms.ci');

      expect(result.success).toBe(true);
      const data = mockPrisma.account.update.mock.calls[0][0].data;
      expect(data.confirmationToken).toBeDefined();
      const dayMs = 24 * 60 * 60 * 1000;
      expect(
        Math.abs(data.tokenExpiry.getTime() - (Date.now() + dayMs)),
      ).toBeLessThan(5000);
      expect(mockMail.sendVerificationEmail).toHaveBeenCalledWith(
        'admin@novasms.ci',
        data.confirmationToken,
      );
    });
  });

  describe('updateProfile / getAccount', () => {
    it('updateProfile exige un nom de boutique non vide', async () => {
      await expect(
        service.updateProfile('acc-1', { companyName: '   ' }),
      ).rejects.toThrow('Company name required');
    });

    it('updateProfile met à jour la boutique et le rôle du user principal', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'admin@novasms.ci',
        passwordHash: 'hash',
      });
      mockPrisma.account.update.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'admin@novasms.ci',
        companyName: 'Nouvelle Boutique',
        onboardingCompleted: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);

      const result = await service.updateProfile('acc-1', {
        companyName: '  Nouvelle Boutique  ',
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { companyName: 'Nouvelle Boutique' },
        }),
      );
      expect(result.account.companyName).toBe('Nouvelle Boutique');
    });

    it('getAccount exige un accountId', async () => {
      await expect(service.getAccount('')).rejects.toThrow(
        'accountId required',
      );
    });

    it('getAccount expose le compte avec le flag 2FA du user principal', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'admin@novasms.ci',
        companyName: 'Boutique',
        creditBalance: 1000,
        backupCodes: [],
        twoFactorSecret: null,
        onboardingCompleted: true,
        passwordHash: 'hash',
      });
      mockPrisma.user.findUnique.mockResolvedValue(primaryUser);

      const result = await service.getAccount('acc-1');

      expect(result.success).toBe(true);
      expect(result.account).toMatchObject({
        id: 'acc-1',
        role: 'Admin',
        twoFactorEnabled: true,
      });
    });
  });

  describe('generateTwoFactorSecret (EN-1641)', () => {
    it('génère un secret base32 et une URL otpauth', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(baseAccount);
      mockPrisma.account.update.mockResolvedValue({});

      const result = await service.generateTwoFactorSecret('acc-1');

      expect(result.success).toBe(true);
      expect(result.secret).toBeDefined();
      expect(result.otpauth_url).toContain('otpauth://totp');
      expect(mockPrisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { twoFactorSecret: result.secret },
      });
    });

    it('rejette un compte inconnu', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      await expect(service.generateTwoFactorSecret('acc-x')).rejects.toThrow(
        'Account not found',
      );
    });
  });
});
