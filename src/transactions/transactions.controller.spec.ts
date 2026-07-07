import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('TransactionsController — Visa et reçus (EN-1703/EN-1705)', () => {
  const service = {
    processVisa: jest.fn(),
    generateReceipt: jest.fn(),
    listTransactions: jest.fn(),
    exportTransactions: jest.fn(),
  };

  const req = { accountId: 'acc-1' } as never;

  const visaBody = {
    amount: 5000,
    cardName: 'AWA KONE',
    cardNumber: '4111111111111111',
    expiryMonth: '12',
    expiryYear: '2028',
    cvv: '123',
  };

  let controller: TransactionsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TransactionsController(
      service as unknown as TransactionsService,
    );
  });

  it('payVisa délègue au service avec le compte du token', async () => {
    service.processVisa.mockResolvedValue({
      transactionId: 'tx-1',
      status: 'Validated',
    });

    const result = await controller.payVisa(visaBody, req);

    expect(result).toEqual({
      success: true,
      transactionId: 'tx-1',
      status: 'Validated',
    });
    expect(service.processVisa).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', amount: 5000 }),
    );
  });

  it('payVisa rejette sans accountId', async () => {
    await expect(controller.payVisa(visaBody, {} as never)).rejects.toThrow(
      'accountId manquant',
    );
  });

  it('downloadReceipt renvoie le PDF avec les bons en-têtes', async () => {
    const buffer = Buffer.from('%PDF');
    service.generateReceipt.mockResolvedValue({
      buffer,
      filename: 'recu-tx-1.pdf',
    });
    const setHeader = jest.fn();
    const end = jest.fn();

    await controller.downloadReceipt('tx-1', req, { setHeader, end } as never);

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="recu-tx-1.pdf"',
    );
    expect(end).toHaveBeenCalledWith(buffer);
  });

  it('exportTransactions renvoie le CSV avec les bons en-têtes', async () => {
    const buffer = Buffer.from('Type;ID\nRecharge;tx-1');
    service.exportTransactions.mockResolvedValue({
      buffer,
      filename: 'transactions-2026-06.csv',
      contentType: 'text/csv; charset=utf-8',
    });
    const setHeader = jest.fn();
    const end = jest.fn();

    await controller.exportTransactions(req, { period: 'previous-month' }, {
      setHeader,
      end,
    } as never);

    expect(service.exportTransactions).toHaveBeenCalledWith('acc-1', {
      period: 'previous-month',
    });
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="transactions-2026-06.csv"',
    );
    expect(setHeader).toHaveBeenCalledWith('Content-Length', buffer.length);
    expect(end).toHaveBeenCalledWith(buffer);
  });

  it('listTransactions applique la pagination', async () => {
    service.listTransactions.mockResolvedValue({ transactions: [] });

    await controller.listTransactions(req, '3', '15');

    expect(service.listTransactions).toHaveBeenCalledWith('acc-1', 3, 15);
  });
});
