import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountController } from './account.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

type TenantRequest = Parameters<AccountController['getMe']>[0];

describe('AccountController — compte, équipe, RGPD (US-015/US-016)', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notificationPrefs: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    invitation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    contact: { findMany: jest.fn() },
    campaign: { findMany: jest.fn() },
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
      prisma as unknown as PrismaService,
      {} as unknown as MailService,
    );
  });

  describe('getMe / getProfile', () => {
    it('rejette une requête sans accountId', async () => {
      await expect(controller.getMe(reqSansCompte)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('retourne le profil utilisateur avec son compte', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'admin@novasms.ci',
        role: 'Admin',
        account: { id: 'acc-1', companyName: 'Boutique' },
      });

      const result = await controller.getMe(req);

      expect(result.success).toBe(true);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'admin@novasms.ci', accountId: 'acc-1' },
        }),
      );
    });

    it('lève NotFound pour un utilisateur inconnu', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(controller.getMe(req)).rejects.toThrow(NotFoundException);
    });

    it('getProfile retourne le compte boutique', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        companyName: 'Boutique Awa',
      });

      const result = await controller.getProfile(req);

      expect(result.account).toMatchObject({ companyName: 'Boutique Awa' });
    });
  });

  describe('updateSettings — alertes budget (US-016)', () => {
    it('refuse une limite supérieure au solde', async () => {
      prisma.account.findUnique.mockResolvedValue({
        creditBalance: new Decimal(1000),
      });

      await expect(
        controller.updateSettings(req, { creditLimit: 5000 }),
      ).rejects.toThrow('dépasser le solde');
    });

    it('met à jour le seuil d’alerte', async () => {
      prisma.account.update.mockResolvedValue({});

      const result = await controller.updateSettings(req, {
        alertThreshold: 500,
      });

      expect(result).toEqual({ success: true });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { alertThreshold: 500 },
      });
    });
  });

  describe('notification-prefs', () => {
    it('retourne les valeurs par défaut sans préférences enregistrées', async () => {
      prisma.notificationPrefs.findUnique.mockResolvedValue(null);

      const result = await controller.getNotificationPrefs(req);

      expect(result.prefs).toMatchObject({
        emailOnCampaignDone: true,
        smsOnCampaignDone: false,
      });
    });

    it('upsert uniquement les booléens fournis', async () => {
      prisma.notificationPrefs.upsert.mockResolvedValue({});

      await controller.updateNotificationPrefs(req, {
        emailOnLowCredits: false,
      });

      const call = prisma.notificationPrefs.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ emailOnLowCredits: false });
      expect(call.create).toMatchObject({
        accountId: 'acc-1',
        emailOnLowCredits: false,
      });
    });
  });

  describe('équipe — invitation/révocation (US-015)', () => {
    it('liste membres et invitations', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
      prisma.invitation.findMany.mockResolvedValue([]);

      const result = await controller.getTeam(req);

      expect(result.users).toHaveLength(1);
      expect(result.invitations).toEqual([]);
    });

    it('refuse une invitation sans email', async () => {
      await expect(
        controller.inviteMember(req, { email: '  ', role: 'Editor' }),
      ).rejects.toThrow('Email requis');
    });

    it('refuse un email déjà membre', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });

      await expect(
        controller.inviteMember(req, {
          email: 'deja@novasms.ci',
          role: 'Editor',
        }),
      ).rejects.toThrow("déjà partie de l'équipe");
    });

    it('crée une invitation avec rôle validé et expiration 7 jours', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.invitation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'inv-1', ...data }),
      );

      const result = await controller.inviteMember(req, {
        email: 'nouveau@novasms.ci',
        role: 'role-bidon',
      });

      expect(result.success).toBe(true);
      const data = prisma.invitation.create.mock.calls[0][0].data;
      // rôle invalide → Editor par défaut
      expect(data.role).toBe('Editor');
      expect(data.status).toBe('Sent');
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(
        Math.abs(data.expiresAt.getTime() - (Date.now() + sevenDays)),
      ).toBeLessThan(5000);
    });

    it('révoque un membre du compte uniquement', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });
      prisma.user.delete.mockResolvedValue({});

      const result = await controller.revokeMember(req, 'user-2');

      expect(result).toEqual({ success: true });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-2', accountId: 'acc-1' },
      });
    });

    it("refuse de révoquer un membre d'un autre compte", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(controller.revokeMember(req, 'user-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('annule une invitation du compte', async () => {
      prisma.invitation.findFirst.mockResolvedValue({ id: 'inv-1' });
      prisma.invitation.delete.mockResolvedValue({});

      const result = await controller.cancelInvitation(req, 'inv-1');

      expect(result).toEqual({ success: true });
    });
  });

  describe('changePassword', () => {
    it('exige les deux mots de passe', async () => {
      await expect(
        controller.changePassword(req, {
          currentPassword: '',
          newPassword: 'nouveaumdp1',
        }),
      ).rejects.toThrow('requis');
    });

    it('refuse un nouveau mot de passe trop court', async () => {
      await expect(
        controller.changePassword(req, {
          currentPassword: 'ancien',
          newPassword: 'court',
        }),
      ).rejects.toThrow('8 caractères');
    });

    it('refuse un mot de passe actuel incorrect', async () => {
      const hash = await bcrypt.hash('le-bon-mdp', 4);
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        passwordHash: hash,
      });

      await expect(
        controller.changePassword(req, {
          currentPassword: 'mauvais-mdp',
          newPassword: 'nouveaumdp1',
        }),
      ).rejects.toThrow('incorrect');
    });

    it('hash et enregistre le nouveau mot de passe', async () => {
      const hash = await bcrypt.hash('le-bon-mdp', 4);
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        passwordHash: hash,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await controller.changePassword(req, {
        currentPassword: 'le-bon-mdp',
        newPassword: 'nouveaumdp1',
      });

      expect(result).toEqual({ success: true });
      const newHash = prisma.user.update.mock.calls[0][0].data.passwordHash;
      expect(newHash).not.toBe('nouveaumdp1'); // jamais en clair
      expect(await bcrypt.compare('nouveaumdp1', newHash)).toBe(true);
    });
  });

  describe('getBalance', () => {
    it('retourne solde, seuil et limite convertis en nombres', async () => {
      prisma.account.findUnique.mockResolvedValue({
        creditBalance: new Decimal(2500),
        alertThreshold: new Decimal(500),
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
      prisma.account.findUnique.mockResolvedValue({
        companyName: 'Boutique',
      });
      prisma.contact.findMany.mockResolvedValue([{ id: 'ct-1' }]);
      prisma.campaign.findMany.mockResolvedValue([{ id: 'camp-1' }]);

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
