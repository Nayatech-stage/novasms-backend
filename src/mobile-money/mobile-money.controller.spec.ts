import { BadRequestException } from '@nestjs/common';
import { MobileMoneyController } from './mobile-money.controller';
import { MobileMoneyService } from './mobile-money.service';

describe('MobileMoneyController — validation opérateurs CI (RG-46/RG-47)', () => {
  const service = {
    initiateTransaction: jest.fn(),
    confirmTransaction: jest.fn(),
    pollTransactionStatus: jest.fn(),
    listTransactions: jest.fn(),
    generateReceiptPdf: jest.fn(),
  };

  const req = {
    accountId: 'acc-1',
    user: { accountId: 'user-1', email: 'admin@novasms.ci' },
  } as never;

  let controller: MobileMoneyController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MobileMoneyController(
      service as unknown as MobileMoneyService,
    );
    service.initiateTransaction.mockResolvedValue({
      id: 'MM-1',
      status: 'pending',
      paymentUrl: null,
      reference: null,
    });
  });

  describe('initiateTransaction — bornes de montant', () => {
    const base = {
      operator: 'WAVE' as const,
      phoneNumber: '+225 07 01 02 03 04',
      amount: 5000,
    };

    it('refuse un montant sous le minimum opérateur (500 XOF)', async () => {
      await expect(
        controller.initiateTransaction({ ...base, amount: 100 }, req),
      ).rejects.toThrow('minimum');
    });

    it('refuse un montant au-dessus du maximum WAVE (500 000 XOF)', async () => {
      await expect(
        controller.initiateTransaction({ ...base, amount: 600_000 }, req),
      ).rejects.toThrow('maximum');
    });

    it('refuse un numéro qui n’a pas 10 chiffres', async () => {
      await expect(
        controller.initiateTransaction(
          { ...base, phoneNumber: '+225 07 01 02' },
          req,
        ),
      ).rejects.toThrow('10 digits');
    });

    it('refuse un préfixe non compatible avec l’opérateur', async () => {
      await expect(
        controller.initiateTransaction(
          // 41 = préfixe Moov, pas Wave
          { ...base, phoneNumber: '+225 41 01 02 03 04' },
          req,
        ),
      ).rejects.toThrow('does not match operator');
    });

    it('exige un OTP à 4 chiffres pour Orange Money', async () => {
      await expect(
        controller.initiateTransaction(
          {
            operator: 'ORANGE',
            phoneNumber: '+225 07 01 02 03 04',
            amount: 5000,
          },
          req,
        ),
      ).rejects.toThrow('4-digit OTP');
    });

    it('initie une transaction WAVE valide avec message opérateur', async () => {
      const result = await controller.initiateTransaction(base, req);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('MM-1');
      expect(result.message).toContain('Wave');
      expect(service.initiateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-1',
          operator: 'WAVE',
          amount: 5000,
          currency: 'XOF',
          country: 'CI',
        }),
      );
    });

    it('rejette sans accountId (TenantInterceptor inactif)', async () => {
      await expect(
        controller.initiateTransaction(base, { user: {} } as never),
      ).rejects.toThrow('accountId manquant');
    });
  });

  describe('pollStatus', () => {
    it('retourne le statut du service', async () => {
      service.pollTransactionStatus.mockResolvedValue({ status: 'completed' });

      const result = await controller.pollStatus('MM-1', req);

      expect(result).toEqual({ success: true, status: 'completed' });
      expect(service.pollTransactionStatus).toHaveBeenCalledWith(
        'MM-1',
        'acc-1',
      );
    });

    it('rejette sans accountId', async () => {
      await expect(controller.pollStatus('MM-1', {} as never)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('confirmTransaction', () => {
    it('retourne success=true quand la transaction est complétée', async () => {
      service.confirmTransaction.mockResolvedValue({
        id: 'MM-1',
        status: 'completed',
      });

      const result = await controller.confirmTransaction(
        'MM-1',
        { otp: '1234' },
        req,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('crédits');
    });

    it('retourne success=false quand la confirmation échoue', async () => {
      service.confirmTransaction.mockResolvedValue({
        id: 'MM-1',
        status: 'failed',
      });

      const result = await controller.confirmTransaction(
        'MM-1',
        { otp: '0000' },
        req,
      );

      expect(result.success).toBe(false);
    });
  });

  describe('listTransactions', () => {
    it('applique la pagination depuis la query string', async () => {
      service.listTransactions.mockResolvedValue([]);

      await controller.listTransactions(req, '10', '20');

      expect(service.listTransactions).toHaveBeenCalledWith('acc-1', {
        limit: 10,
        offset: 20,
      });
    });

    it('utilise les valeurs par défaut sans query', async () => {
      service.listTransactions.mockResolvedValue([]);

      await controller.listTransactions(req);

      expect(service.listTransactions).toHaveBeenCalledWith('acc-1', {
        limit: 50,
        offset: 0,
      });
    });
  });

  describe('downloadReceipt', () => {
    it('renvoie le PDF avec les en-têtes de téléchargement', async () => {
      const pdf = Buffer.from('%PDF-fake');
      service.generateReceiptPdf.mockResolvedValue(pdf);
      const set = jest.fn();
      const end = jest.fn();

      await controller.downloadReceipt('MM-1', req, { set, end } as never);

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Content-Disposition': expect.stringContaining('receipt-MM-1.pdf'),
        }),
      );
      expect(end).toHaveBeenCalledWith(pdf);
    });
  });
});
