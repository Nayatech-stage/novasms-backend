import { Decimal } from '@prisma/client/runtime/library';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TransactionsService — paiement Visa (RG-48) et reçus (RG-51)', () => {
  const originalEnv = process.env;

  const prisma = {
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    account: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
    },
  };

  let service: TransactionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mode simulation : pas de clé Stripe
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    service = new TransactionsService(prisma as unknown as PrismaService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const visaParams = {
    accountId: 'acc-1',
    amount: 5000,
    cardName: 'AWA KONE',
    cardNumber: '4111111111111111',
    expiryMonth: '12',
    expiryYear: '2028',
    cvv: '123',
  };

  describe('processVisa (simulation)', () => {
    it('rejette un montant inférieur à 1 000 FCFA', async () => {
      await expect(
        service.processVisa({ ...visaParams, amount: 500 }),
      ).rejects.toThrow('Montant minimum 1 000 FCFA');
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('valide la transaction, crédite le compte et crée la facture', async () => {
      prisma.transaction.create.mockResolvedValue({
        id: 'tx-1',
        amount: new Decimal(5000),
      });
      prisma.account.update.mockResolvedValue({});
      prisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      const result = await service.processVisa(visaParams);

      expect(result).toEqual({ transactionId: 'tx-1', status: 'Validated' });
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-1',
          method: 'Visa',
          status: 'Validated',
        }),
      });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { creditBalance: { increment: expect.anything() } },
      });
      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: { transactionId: 'tx-1', s3Path: null },
      });
    });
  });

  describe('generateReceipt', () => {
    it('rejette une transaction inconnue ou d’un autre compte', async () => {
      prisma.transaction.findFirst.mockResolvedValue(null);

      await expect(service.generateReceipt('tx-x', 'acc-1')).rejects.toThrow(
        'Transaction introuvable',
      );
      expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
        where: { id: 'tx-x', accountId: 'acc-1' },
        include: { invoice: true },
      });
    });

    it('génère un PDF non vide avec le nom de fichier du reçu', async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        id: 'tx-1',
        reference: 'VISA-SIM-1',
        amount: new Decimal(5000),
        createdAt: new Date('2026-06-01T10:00:00Z'),
        method: 'Visa',
        status: 'Validated',
        invoice: null,
      });
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc-1',
        companyName: 'Boutique Awa',
        adminEmail: 'awa@example.ci',
      });

      const receipt = await service.generateReceipt('tx-1', 'acc-1');

      expect(receipt.buffer).toBeInstanceOf(Buffer);
      expect(receipt.buffer.length).toBeGreaterThan(1000);
      // Signature PDF
      expect(receipt.buffer.subarray(0, 4).toString()).toBe('%PDF');
      expect(receipt.filename).toMatch(/\.pdf$/);
    });
  });

  describe('listTransactions', () => {
    it('pagine et isole par compte', async () => {
      prisma.transaction.findMany.mockResolvedValue([{ id: 'tx-1' }]);
      prisma.transaction.count.mockResolvedValue(31);

      const result = await service.listTransactions('acc-1', 2, 10);

      expect(result).toMatchObject({ total: 31, page: 2, limit: 10 });
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'acc-1' },
          skip: 10,
          take: 10,
        }),
      );
    });
  });
});
