import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

const HASHED_PASSWORD = bcrypt.hashSync('SecurePass123!', 10);

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
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock_token'),
  verify: jest.fn(),
};

const mockMail = {
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
};

describe('AuthService -- US-001 & US-002', () => {
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
  });

  describe('US-001 - register()', () => {
    const registerDto = {
      email: 'test@boutique.ci',
      password: 'SecurePass123!',
      nom: 'Boutique Awa',
      nomBoutique: 'Boutique Awa',
      pays: 'CI',
    };
    const createdAccount = {
      id: 'acc-1',
      adminEmail: 'test@boutique.ci',
      companyName: 'Boutique Awa',
    };

    it('cree un compte avec email, nom, boutique et pays', async () => {
      mockPrisma.account.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdAccount);
      mockPrisma.account.create.mockResolvedValue(createdAccount);
      mockPrisma.user.create.mockResolvedValue({ id: 'usr-1' });

      const result = await service.register(registerDto);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(mockPrisma.account.create).toHaveBeenCalledTimes(1);
      expect(mockMail.sendVerificationEmail).toHaveBeenCalledWith(
        registerDto.email,
        expect.any(String),
      );
    });

    it('rejette si email existe deja (ConflictException)', async () => {
      mockPrisma.account.findUnique.mockResolvedValueOnce({
        id: 'existing',
        adminEmail: registerDto.email,
      });
      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('hash le mot de passe -- jamais en clair en DB', async () => {
      mockPrisma.account.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdAccount);
      mockPrisma.account.create.mockImplementation(async (args) => {
        const stored = args?.data?.passwordHash;
        expect(stored).not.toEqual(registerDto.password);
        expect(stored.startsWith('$2')).toBe(true);
        return createdAccount;
      });
      mockPrisma.user.create.mockResolvedValue({ id: 'usr-1' });
      await service.register(registerDto);
    });

    it('envoie un email de verification apres inscription', async () => {
      mockPrisma.account.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdAccount);
      mockPrisma.account.create.mockResolvedValue(createdAccount);
      mockPrisma.user.create.mockResolvedValue({ id: 'usr-1' });
      await service.register(registerDto);
      expect(mockMail.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('US-002 - login()', () => {
    const mockAccount = {
      id: 'acc-1',
      adminEmail: 'user@test.ci',
      companyName: 'Test Boutique',
      passwordHash: HASHED_PASSWORD,
      emailVerified: true,
      loginAttempts: 0,
      lockedUntil: null,
      twoFactorCode: null,
      twoFactorCodeExpiry: null,
      twoFactorSecret: null,
      sector: null,
      primaryChannels: [],
      onboardingCompleted: false,
    };
    const mockUser = {
      id: 'usr-1',
      accountId: 'acc-1',
      email: 'user@test.ci',
      passwordHash: HASHED_PASSWORD,
      role: 'Admin',
      twoFactorEnabled: false,
    };

    it('retourne access_token avec credentials valides', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(mockAccount);
      mockPrisma.account.update.mockResolvedValue(mockAccount);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.login('user@test.ci', 'SecurePass123!');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      const token = (result as any).accessToken ?? (result as any).access_token;
      expect(token).toBeDefined();
    });

    it('leve UnauthorizedException si mot de passe incorrect', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(mockAccount);
      mockPrisma.account.update.mockResolvedValue(mockAccount);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.login('user@test.ci', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('leve UnauthorizedException si email inconnu', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(service.login('unknown@test.ci', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('bloque le compte apres 5 tentatives echouees', async () => {
      const lockedAccount = {
        ...mockAccount,
        loginAttempts: 4,
        lockedUntil: null,
      };
      mockPrisma.account.findFirst.mockResolvedValue(lockedAccount);
      mockPrisma.account.update.mockResolvedValue({
        ...lockedAccount,
        lockedUntil: new Date(Date.now() + 900000),
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.login('user@test.ci', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.account.update).toHaveBeenCalled();
    });

    it('leve UnauthorizedException si email non verifie', async () => {
      mockPrisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        emailVerified: false,
      });
      await expect(
        service.login('user@test.ci', 'SecurePass123!'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('US-002 - requestPasswordReset()', () => {
    it('envoie email de reset si le compte existe', async () => {
      mockPrisma.account.findFirst.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'user@test.ci',
      });
      mockPrisma.account.update.mockResolvedValue({});
      const result = await service.requestPasswordReset('user@test.ci');
      expect(result.success).toBe(true);
      expect(mockMail.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@test.ci',
        expect.any(String),
      );
    });

    it('ne leve pas d erreur si email inconnu (securite anti-enum)', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      const result = await service.requestPasswordReset('inconnu@test.ci');
      expect(result.success).toBe(true);
      expect(mockMail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('US-001 - verifyEmail()', () => {
    it('marque email comme verifie avec token valide', async () => {
      mockPrisma.account.findFirst.mockResolvedValue({
        id: 'acc-1',
        adminEmail: 'user@test.ci',
        confirmationToken: 'valid-token',
        tokenExpiry: new Date(Date.now() + 3600000),
      });
      mockPrisma.account.update.mockResolvedValue({});
      const result = await service.verifyEmail('valid-token');
      expect(result.success).toBe(true);
      expect(mockPrisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ emailVerified: true }),
        }),
      );
    });

    it('leve BadRequestException si token invalide ou expire', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(service.verifyEmail('expired')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
