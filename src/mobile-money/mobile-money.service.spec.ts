import { Decimal } from '@prisma/client/runtime/library';
import { MobileMoneyService } from './mobile-money.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderFactory } from '../providers/payment/payment.provider.factory';

describe('MobileMoneyService — recharge crédits (US-017 / EN-1665)', () => {
  const baseTransaction = {
    id: 'MM-1',
    status: 'pending',
    createdAt: new Date(),
    accountId: 'acc-1',
    userId: 'user-1',
    operator: 'WAVE',
    phoneNumber: '+2250700000000',
    amount: new Decimal(5000),
    currency: 'XOF',
    externalTransactionId: null,
    completedAt: null,
  };

  const prisma = {
    user: { findFirst: jest.fn() },
    mobileMoneyTransaction: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const provider = {
    initiatePayment: jest.fn(),
    confirmPayment: jest.fn(),
    getStatus: jest.fn(),
  };

  const factory = {
    getMobileMoneyProvider: jest.fn(() => provider),
  };

  let service: MobileMoneyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MobileMoneyService(
      prisma as unknown as PrismaService,
      factory as unknown as PaymentProviderFactory,
    );
  });

  describe('initiateTransaction', () => {
    const params = {
      userId: 'user-1',
      accountId: 'acc-1',
      operator: 'WAVE' as const,
      phoneNumber: '+2250700000000',
      amount: 5000,
      currency: 'XOF',
    };

    it('rejette un montant nul ou négatif', async () => {
      await expect(
        service.initiateTransaction({ ...params, amount: 0 }),
      ).rejects.toThrow('Le montant doit être supérieur à 0');
      expect(prisma.mobileMoneyTransaction.create).not.toHaveBeenCalled();
    });

    it("rejette si l'utilisateur n'appartient pas au compte", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.initiateTransaction(params)).rejects.toThrow(
        'Utilisateur du compte introuvable',
      );
    });

    it('crée la transaction pending et délègue au provider', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      prisma.mobileMoneyTransaction.create.mockResolvedValue(baseTransaction);
      provider.initiatePayment.mockResolvedValue({
        success: true,
        transactionId: 'ext-1',
        reference: 'ref-novasend-1',
        status: 'pending',
        paymentUrl: 'https://pay.wave.com/x',
      });
      prisma.mobileMoneyTransaction.update.mockResolvedValue({
        ...baseTransaction,
        externalTransactionId: 'ref-novasend-1',
      });

      const result = await service.initiateTransaction(params);

      expect(prisma.mobileMoneyTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pending',
            accountId: 'acc-1',
            operator: 'WAVE',
          }),
        }),
      );
      expect(provider.initiatePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          operator: 'WAVE',
          amount: 5000,
          country: 'CI',
        }),
      );
      // La référence NovaSend est stockée en priorité
      expect(prisma.mobileMoneyTransaction.update).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        data: { externalTransactionId: 'ref-novasend-1' },
      });
      expect(result.status).toBe('pending');
      expect(result.paymentUrl).toBe('https://pay.wave.com/x');
    });
  });

  describe('confirmTransaction', () => {
    it('rejette une transaction inconnue', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmTransaction('MM-x', '1234', 'acc-1'),
      ).rejects.toThrow('Transaction non trouvée');
    });

    it('rejette si la transaction appartient à un autre compte (isolation)', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue({
        ...baseTransaction,
        accountId: 'acc-AUTRE',
      });

      await expect(
        service.confirmTransaction('MM-1', '1234', 'acc-1'),
      ).rejects.toThrow('Non autorisé');
    });

    it('rejette une transaction déjà complétée', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue({
        ...baseTransaction,
        status: 'completed',
      });

      await expect(
        service.confirmTransaction('MM-1', '1234', 'acc-1'),
      ).rejects.toThrow('non-pending');
    });

    it('marque failed sans créditer quand le provider refuse l’OTP', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(
        baseTransaction,
      );
      provider.confirmPayment.mockResolvedValue({
        success: false,
        status: 'failed',
        error: 'OTP invalide',
      });
      prisma.mobileMoneyTransaction.update.mockResolvedValue({
        ...baseTransaction,
        status: 'failed',
      });

      const result = await service.confirmTransaction('MM-1', '00', 'acc-1');

      expect(result.status).toBe('failed');
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('complète la transaction et crédite le solde du compte', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(
        baseTransaction,
      );
      provider.confirmPayment.mockResolvedValue({
        success: true,
        status: 'completed',
        transactionId: 'ext-99',
      });
      prisma.mobileMoneyTransaction.update.mockResolvedValue({
        ...baseTransaction,
        status: 'completed',
        externalTransactionId: 'ext-99',
        completedAt: new Date(),
      });
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        creditBalance: new Decimal(1000),
      });
      prisma.account.update.mockResolvedValue({});

      const result = await service.confirmTransaction('MM-1', '1234', 'acc-1');

      expect(result.status).toBe('completed');
      expect(prisma.mobileMoneyTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
            externalTransactionId: 'ext-99',
          }),
        }),
      );
      // 1000 + 5000 = 6000
      const updateCall = prisma.account.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'acc-1' });
      expect(updateCall.data.creditBalance.toString()).toBe('6000');
    });
  });

  describe('pollTransactionStatus', () => {
    it('retourne le statut stocké sans appeler le provider si terminal', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue({
        ...baseTransaction,
        status: 'completed',
      });

      const result = await service.pollTransactionStatus('MM-1', 'acc-1');

      expect(result).toEqual({ status: 'completed' });
      expect(provider.getStatus).not.toHaveBeenCalled();
    });

    it('complète et crédite quand le provider confirme (idempotent)', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(
        baseTransaction,
      );
      provider.getStatus.mockResolvedValue({
        success: true,
        status: 'completed',
      });
      prisma.mobileMoneyTransaction.update.mockResolvedValue({});
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        creditBalance: new Decimal(0),
      });
      prisma.account.update.mockResolvedValue({});

      const result = await service.pollTransactionStatus('MM-1', 'acc-1');

      expect(result).toEqual({ status: 'completed' });
      expect(prisma.account.update).toHaveBeenCalledTimes(1);
    });

    it('marque failed sans créditer quand le provider échoue', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(
        baseTransaction,
      );
      provider.getStatus.mockResolvedValue({
        success: false,
        status: 'failed',
      });
      prisma.mobileMoneyTransaction.update.mockResolvedValue({});

      const result = await service.pollTransactionStatus('MM-1', 'acc-1');

      expect(result).toEqual({ status: 'failed' });
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('reste pending quand le provider est toujours en attente', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(
        baseTransaction,
      );
      provider.getStatus.mockResolvedValue({
        success: true,
        status: 'pending',
      });

      const result = await service.pollTransactionStatus('MM-1', 'acc-1');

      expect(result).toEqual({ status: 'pending' });
      expect(prisma.mobileMoneyTransaction.update).not.toHaveBeenCalled();
    });
  });

  describe('getTransactionById', () => {
    it("retourne null pour une transaction d'un autre compte", async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue({
        ...baseTransaction,
        accountId: 'acc-AUTRE',
      });

      const result = await service.getTransactionById('MM-1', 'acc-1');

      expect(result).toBeNull();
    });

    it('retourne la transaction du compte', async () => {
      prisma.mobileMoneyTransaction.findUnique.mockResolvedValue(
        baseTransaction,
      );

      const result = await service.getTransactionById('MM-1', 'acc-1');

      expect(result).toMatchObject({ id: 'MM-1', accountId: 'acc-1' });
    });
  });
});
