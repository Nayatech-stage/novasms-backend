import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

type TenantRequest = Parameters<AccountController['getMe']>[0];

describe('AccountController — compte, équipe, RGPD (US-015/US-016)', () => {
  const accountService = {
    getMe: jest.fn(),
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updateSettings: jest.fn(),
    getNotificationPrefs: jest.fn(),
    updateNotificationPrefs: jest.fn(),
    getTeam: jest.fn(),
    inviteMember: jest.fn(),
    revokeMember: jest.fn(),
    cancelInvitation: jest.fn(),
    changePassword: jest.fn(),
    getBalance: jest.fn(),
    exportAccountData: jest.fn(),
    getCreditUsageSummary: jest.fn(),
    getCreditUsageHistory: jest.fn(),
  };

  const req = {
    user: {
      sub: 'user-1',
      email: 'admin@novasms.ci',
      accountId: 'acc-1',
      role: 'Admin',
    },
    accountId: 'acc-1',
  } as unknown as TenantRequest;

  const reqSansCompte = {
    user: { sub: 'user-1', email: 'admin@novasms.ci' },
  } as unknown as TenantRequest;

  let controller: AccountController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AccountController(
      accountService as unknown as AccountService,
    );
  });

  describe('getMe / getProfile', () => {
    it('rejette une requête sans accountId', async () => {
      await expect(controller.getMe(reqSansCompte)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('retourne le profil utilisateur avec son compte', async () => {
      const user = {
        id: 'user-1',
        email: 'admin@novasms.ci',
        role: 'Admin',
        account: { id: 'acc-1', companyName: 'Boutique' },
      };
      accountService.getMe.mockResolvedValue(user);

      const result = await controller.getMe(req);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(user);
      expect(accountService.getMe).toHaveBeenCalledWith(
        'acc-1',
        'admin@novasms.ci',
      );
    });

    it('lève NotFound pour un utilisateur inconnu', async () => {
      accountService.getMe.mockRejectedValue(
        new NotFoundException('Utilisateur introuvable'),
      );

      await expect(controller.getMe(req)).rejects.toThrow(NotFoundException);
    });

    it('getProfile retourne le compte boutique', async () => {
      accountService.getProfile.mockResolvedValue({
        id: 'acc-1',
        companyName: 'Boutique Awa',
      });

      const result = await controller.getProfile(req);

      expect(result.account).toMatchObject({ companyName: 'Boutique Awa' });
    });
  });

  describe('updateSettings — alertes budget (US-016)', () => {
    it('refuse une limite supérieure au solde', async () => {
      accountService.updateSettings.mockRejectedValue(
        new BadRequestException(
          "La limite d'utilisation ne peut pas dépasser le solde actuel",
        ),
      );

      await expect(
        controller.updateSettings(req, { creditLimit: 5000 }),
      ).rejects.toThrow('dépasser le solde');
    });

    it("met à jour le seuil d'alerte", async () => {
      accountService.updateSettings.mockResolvedValue(undefined);

      const result = await controller.updateSettings(req, {
        alertThreshold: 500,
      });

      expect(result).toEqual({ success: true });
      expect(accountService.updateSettings).toHaveBeenCalledWith('acc-1', {
        alertThreshold: 500,
      });
    });
  });

  describe('notification-prefs', () => {
    it('retourne les valeurs par défaut sans préférences enregistrées', async () => {
      accountService.getNotificationPrefs.mockResolvedValue({
        emailOnCampaignDone: true,
        emailOnLowCredits: true,
        emailOnTeamInvite: true,
        smsOnCampaignDone: false,
        smsOnLowCredits: true,
        weeklyReportEmail: true,
        automationAlertsEmail: true,
      });

      const result = await controller.getNotificationPrefs(req);

      expect(result.prefs).toMatchObject({
        emailOnCampaignDone: true,
        smsOnCampaignDone: false,
      });
    });

    it('upsert uniquement les booléens fournis', async () => {
      accountService.updateNotificationPrefs.mockResolvedValue(undefined);

      await controller.updateNotificationPrefs(req, {
        emailOnLowCredits: false,
      });

      expect(accountService.updateNotificationPrefs).toHaveBeenCalledWith(
        'acc-1',
        { emailOnLowCredits: false },
      );
    });
  });

  describe('équipe — invitation/révocation (US-015)', () => {
    it('liste membres et invitations', async () => {
      accountService.getTeam.mockResolvedValue({
        users: [{ id: 'user-1' }],
        invitations: [],
      });

      const result = await controller.getTeam(req);

      expect(result.users).toHaveLength(1);
      expect(result.invitations).toEqual([]);
    });

    it('refuse une invitation sans email', async () => {
      accountService.inviteMember.mockRejectedValue(
        new BadRequestException('Email requis'),
      );

      await expect(
        controller.inviteMember(req, { email: '  ', role: 'Editor' }),
      ).rejects.toThrow('Email requis');
    });

    it('refuse un email déjà membre', async () => {
      accountService.inviteMember.mockRejectedValue(
        new BadRequestException("Cet email fait déjà partie de l'équipe"),
      );

      await expect(
        controller.inviteMember(req, {
          email: 'deja@novasms.ci',
          role: 'Editor',
        }),
      ).rejects.toThrow("déjà partie de l'équipe");
    });

    it('crée une invitation et retourne success', async () => {
      const invitation = {
        id: 'inv-1',
        email: 'nouveau@novasms.ci',
        role: 'Editor',
        status: 'Sent',
      };
      accountService.inviteMember.mockResolvedValue(invitation);

      const result = await controller.inviteMember(req, {
        email: 'nouveau@novasms.ci',
        role: 'role-bidon',
      });

      expect(result.success).toBe(true);
      expect(result.invitation).toEqual(invitation);
      expect(accountService.inviteMember).toHaveBeenCalledWith(
        'acc-1',
        'admin@novasms.ci',
        { email: 'nouveau@novasms.ci', role: 'role-bidon' },
      );
    });

    it('révoque un membre du compte uniquement', async () => {
      accountService.revokeMember.mockResolvedValue(undefined);

      const result = await controller.revokeMember(req, 'user-2');

      expect(result).toEqual({ success: true });
      expect(accountService.revokeMember).toHaveBeenCalledWith(
        'acc-1',
        'user-2',
      );
    });

    it("refuse de révoquer un membre d'un autre compte", async () => {
      accountService.revokeMember.mockRejectedValue(
        new NotFoundException('Membre introuvable'),
      );

      await expect(controller.revokeMember(req, 'user-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('annule une invitation du compte', async () => {
      accountService.cancelInvitation.mockResolvedValue(undefined);

      const result = await controller.cancelInvitation(req, 'inv-1');

      expect(result).toEqual({ success: true });
      expect(accountService.cancelInvitation).toHaveBeenCalledWith(
        'acc-1',
        'inv-1',
      );
    });
  });

  describe('changePassword', () => {
    it('exige les deux mots de passe', async () => {
      accountService.changePassword.mockRejectedValue(
        new BadRequestException('Mot de passe actuel et nouveau requis'),
      );

      await expect(
        controller.changePassword(req, {
          currentPassword: '',
          newPassword: 'nouveaumdp1',
        }),
      ).rejects.toThrow('requis');
    });

    it('refuse un nouveau mot de passe trop court', async () => {
      accountService.changePassword.mockRejectedValue(
        new BadRequestException(
          'Le mot de passe doit contenir au moins 8 caractères',
        ),
      );

      await expect(
        controller.changePassword(req, {
          currentPassword: 'ancien',
          newPassword: 'court',
        }),
      ).rejects.toThrow('8 caractères');
    });

    it('refuse un mot de passe actuel incorrect', async () => {
      accountService.changePassword.mockRejectedValue(
        new BadRequestException('Mot de passe actuel incorrect'),
      );

      await expect(
        controller.changePassword(req, {
          currentPassword: 'mauvais-mdp',
          newPassword: 'nouveaumdp1',
        }),
      ).rejects.toThrow('incorrect');
    });

    it('délègue le changement au service et retourne success', async () => {
      accountService.changePassword.mockResolvedValue(undefined);

      const result = await controller.changePassword(req, {
        currentPassword: 'le-bon-mdp',
        newPassword: 'nouveaumdp1',
      });

      expect(result).toEqual({ success: true });
      expect(accountService.changePassword).toHaveBeenCalledWith(
        'acc-1',
        'admin@novasms.ci',
        { currentPassword: 'le-bon-mdp', newPassword: 'nouveaumdp1' },
      );
    });
  });

  describe('getBalance', () => {
    it('retourne solde, seuil et limite convertis en nombres', async () => {
      accountService.getBalance.mockResolvedValue({
        balance: 2500,
        alertThreshold: 500,
        creditLimit: null,
        language: 'fr',
        timezone: 'Africa/Abidjan',
      });

      const result = await controller.getBalance(req);

      expect(result).toEqual({
        success: true,
        balance: 2500,
        alertThreshold: 500,
        creditLimit: null,
        language: 'fr',
        timezone: 'Africa/Abidjan',
      });
    });
  });

  describe('export RGPD (EN-1682)', () => {
    it('exporte compte, contacts et campagnes en JSON téléchargeable', async () => {
      accountService.exportAccountData.mockResolvedValue({
        exportedAt: '2026-06-30T00:00:00.000Z',
        account: { companyName: 'Boutique' },
        contacts: [{ id: 'ct-1' }],
        campaigns: [{ id: 'camp-1' }],
      });

      const setHeader = jest.fn();
      const json = jest.fn();
      const res = { setHeader, json } as never;

      await controller.exportAccountData(req, res);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json',
      );
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('novasms-export-'),
      );
      const exported = json.mock.calls[0][0];
      expect(exported.contacts).toHaveLength(1);
      expect(exported.campaigns).toHaveLength(1);
      expect(exported.exportedAt).toBeDefined();
    });
  });
});
