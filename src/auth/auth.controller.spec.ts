import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtBlacklistService } from './jwt-blacklist.service';

const mockAuthService = {
  register: jest.fn().mockResolvedValue({ id: 'acc-1' }),
  verifyEmail: jest.fn().mockResolvedValue({ verified: true }),
  resendConfirmationEmail: jest.fn().mockResolvedValue({ sent: true }),
  login: jest.fn().mockResolvedValue({ accessToken: 'jwt' }),
  requestPasswordReset: jest.fn().mockResolvedValue({ sent: true }),
  resetPassword: jest.fn().mockResolvedValue({ reset: true }),
  markOnboardingCompleted: jest.fn().mockResolvedValue({ done: true }),
  updateProfile: jest.fn().mockResolvedValue({ updated: true }),
  verifyTwoFactor: jest.fn().mockResolvedValue({ accessToken: 'jwt2' }),
  refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'jwt3' }),
  generateTwoFactorSecret: jest.fn().mockResolvedValue({ secret: 'totp' }),
  enableTwoFactor: jest.fn().mockResolvedValue({ enabled: true }),
  disableTwoFactor: jest.fn().mockResolvedValue({ disabled: true }),
  sendTwoFactorSms: jest.fn().mockResolvedValue({ sent: true }),
  getAccount: jest.fn().mockResolvedValue({ id: 'acc-1' }),
};

const mockBlacklist = {
  revoke: jest.fn().mockResolvedValue(undefined),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: JwtBlacklistService, useValue: mockBlacklist },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('register délègue au service', async () => {
    const body = {
      email: 'a@x.ci',
      motDePasse: 'Secret123!',
      nomEntreprise: 'Nova',
    };
    await expect(controller.register(body as never)).resolves.toEqual({
      id: 'acc-1',
    });
    expect(mockAuthService.register).toHaveBeenCalledWith(body);
  });

  it('verifyEmail passe le token au service', async () => {
    await expect(controller.verifyEmail('tok-1')).resolves.toEqual({
      verified: true,
    });
    expect(mockAuthService.verifyEmail).toHaveBeenCalledWith('tok-1');
  });

  it('resendConfirmation passe l’email au service', async () => {
    await controller.resendConfirmation({ email: 'a@x.ci' });
    expect(mockAuthService.resendConfirmationEmail).toHaveBeenCalledWith(
      'a@x.ci',
    );
  });

  it('login délègue email + mot de passe', async () => {
    await expect(
      controller.login({ email: 'a@x.ci', motDePasse: 'pw' }),
    ).resolves.toEqual({ accessToken: 'jwt' });
    expect(mockAuthService.login).toHaveBeenCalledWith('a@x.ci', 'pw');
  });

  it('forgotPassword valide le schéma puis délègue', async () => {
    await controller.forgotPassword({ email: 'a@x.ci' });
    expect(mockAuthService.requestPasswordReset).toHaveBeenCalledWith('a@x.ci');
  });

  it('forgotPassword rejette un email invalide', async () => {
    await expect(
      controller.forgotPassword({ email: 'pas-un-email' }),
    ).rejects.toThrow();
    expect(mockAuthService.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('resetPassword valide le schéma puis délègue', async () => {
    await controller.resetPassword('tok-1', { newPassword: 'NouveauPass123!' });
    expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
      'tok-1',
      'NouveauPass123!',
    );
  });

  it('resetPassword rejette un mot de passe trop court', async () => {
    await expect(
      controller.resetPassword('tok-1', { newPassword: 'a' }),
    ).rejects.toThrow();
    expect(mockAuthService.resetPassword).not.toHaveBeenCalled();
  });

  it('markOnboardingCompleted exige un accountId', async () => {
    await expect(controller.markOnboardingCompleted(null)).rejects.toThrow(
      BadRequestException,
    );
    await controller.markOnboardingCompleted('acc-1');
    expect(mockAuthService.markOnboardingCompleted).toHaveBeenCalledWith(
      'acc-1',
    );
  });

  it('updateProfile exige un accountId puis délègue', async () => {
    const body = { companyName: 'Nova', role: 'CEO' };
    await expect(controller.updateProfile(null, body)).rejects.toThrow(
      BadRequestException,
    );
    await controller.updateProfile('acc-1', body);
    expect(mockAuthService.updateProfile).toHaveBeenCalledWith('acc-1', body);
  });

  it('verifyTwoFactor délègue token + code', async () => {
    await controller.verifyTwoFactor({ twoFactorToken: 't2f', code: '123456' });
    expect(mockAuthService.verifyTwoFactor).toHaveBeenCalledWith(
      't2f',
      '123456',
    );
  });

  it('refresh délègue le refreshToken', async () => {
    await controller.refresh({ refreshToken: 'rt-1' });
    expect(mockAuthService.refreshTokens).toHaveBeenCalledWith('rt-1');
  });

  it('logout révoque le token quand iat/exp présents', async () => {
    const req = {
      user: { accountId: 'acc-1', iat: 100, exp: 200 },
    } as unknown as Request & {
      user?: { accountId: string; iat?: number; exp?: number };
    };
    await expect(controller.logout(req)).resolves.toEqual({
      success: true,
      message: 'Déconnecté avec succès',
    });
    expect(mockBlacklist.revoke).toHaveBeenCalledWith('acc-1', 100, 200);
  });

  it('logout n’appelle pas la blacklist sans iat/exp', async () => {
    const req = { user: { accountId: 'acc-1' } } as unknown as Request & {
      user?: { accountId: string; iat?: number; exp?: number };
    };
    await expect(controller.logout(req)).resolves.toEqual({
      success: true,
      message: 'Déconnecté avec succès',
    });
    expect(mockBlacklist.revoke).not.toHaveBeenCalled();
  });

  it('generateTwoFactorSecret exige un accountId puis délègue', async () => {
    await expect(controller.generateTwoFactorSecret(null)).rejects.toThrow(
      BadRequestException,
    );
    await controller.generateTwoFactorSecret('acc-1');
    expect(mockAuthService.generateTwoFactorSecret).toHaveBeenCalledWith(
      'acc-1',
    );
  });

  it('enableTwoFactor exige un accountId puis délègue', async () => {
    await expect(
      controller.enableTwoFactor(null, { code: '123456' }),
    ).rejects.toThrow(BadRequestException);
    await controller.enableTwoFactor('acc-1', { code: '123456' });
    expect(mockAuthService.enableTwoFactor).toHaveBeenCalledWith(
      'acc-1',
      '123456',
    );
  });

  it('disableTwoFactor exige un accountId puis délègue', async () => {
    await expect(controller.disableTwoFactor(null)).rejects.toThrow(
      BadRequestException,
    );
    await controller.disableTwoFactor('acc-1');
    expect(mockAuthService.disableTwoFactor).toHaveBeenCalledWith('acc-1');
  });

  it('sendTwoFactorSms exige un accountId puis délègue', async () => {
    await expect(
      controller.sendTwoFactorSms(null, { phone: '+225070000' }),
    ).rejects.toThrow(BadRequestException);
    await controller.sendTwoFactorSms('acc-1', { phone: '+225070000' });
    expect(mockAuthService.sendTwoFactorSms).toHaveBeenCalledWith(
      'acc-1',
      '+225070000',
    );
  });

  it('me exige un accountId puis délègue', async () => {
    await expect(controller.me(null)).rejects.toThrow(BadRequestException);
    await expect(controller.me('acc-1')).resolves.toEqual({ id: 'acc-1' });
    expect(mockAuthService.getAccount).toHaveBeenCalledWith('acc-1');
  });
});
