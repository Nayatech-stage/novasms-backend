import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomInt } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import PDFDocument from 'pdfkit';
import { PaymentProviderFactory } from '../providers/payment/payment.provider.factory';
import type { MobileMoneyOperator } from '../providers/payment/interfaces/mobile-money.provider.interface';

// Re-export pour compatibilité avec les imports existants du controller
export type { MobileMoneyOperator };

export type MobileMoneyTransaction = {
  transactionId: string;
  id: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  accountId: string;
  userId: string;
  operator: MobileMoneyOperator;
  phoneNumber: string;
  amount: Decimal;
  currency: string;
  externalTransactionId: string | null;
  completedAt: Date | null;
};

type InitiateTransactionParams = {
  userId: string;
  userEmail?: string;
  accountId: string;
  operator: MobileMoneyOperator;
  phoneNumber: string;
  amount: number;
  currency: string;
  description?: string;
  otp?: string; // Orange Money : code obtenu via #144*82#
  country?: string; // CI | CM (défaut CI)
  customerName?: string;
};

@Injectable()
export class MobileMoneyService {
  private readonly logger = new Logger(MobileMoneyService.name);

  constructor(
    private prisma: PrismaService,
    private paymentProviderFactory: PaymentProviderFactory,
  ) {}

  /**
   * Initie une transaction Mobile Money.
   * Crée l'enregistrement DB puis délègue l'appel opérateur au provider.
   */
  async initiateTransaction(
    params: InitiateTransactionParams,
  ): Promise<
    MobileMoneyTransaction & { paymentUrl?: string; reference?: string }
  > {
    const {
      userId,
      userEmail,
      accountId,
      operator,
      phoneNumber,
      amount,
      currency,
    } = params;

    if (amount <= 0) {
      throw new Error('Le montant doit être supérieur à 0');
    }

    const internalTransactionId = `MM-${Date.now()}-${randomInt(10000, 99999)}`;

    const user = await this.prisma.user.findFirst({
      where: {
        accountId,
        OR: [{ id: userId }, ...(userEmail ? [{ email: userEmail }] : [])],
      },
      select: { id: true },
    });

    if (!user) {
      throw new Error('Utilisateur du compte introuvable');
    }

    const transaction = await this.prisma.mobileMoneyTransaction.create({
      data: {
        id: internalTransactionId,
        status: 'pending',
        userId: user.id,
        accountId,
        operator,
        phoneNumber,
        amount: new Decimal(amount),
        currency,
      },
    });

    // Déléguer l'initiation à l'opérateur via le provider (simulation ou NovaSend)
    const provider = this.paymentProviderFactory.getMobileMoneyProvider();
    const providerResult = await provider.initiatePayment({
      operator,
      phoneNumber,
      amount,
      currency,
      description: params.description ?? 'Recharge crédit NovaSMS',
      accountId,
      userId: user.id,
      otp: params.otp,
      country: params.country ?? 'CI',
      customerName: params.customerName,
    });

    // Stocker la référence NovaSend (UUID) en priorité — utilisée pour GET /v1/payin/{reference}
    const externalRef =
      providerResult.reference || providerResult.transactionId;
    if (externalRef) {
      await this.prisma.mobileMoneyTransaction.update({
        where: { id: internalTransactionId },
        data: { externalTransactionId: externalRef },
      });
    }

    return {
      transactionId: transaction.id,
      id: transaction.id,
      status: transaction.status as 'pending',
      createdAt: transaction.createdAt,
      accountId: transaction.accountId,
      userId: transaction.userId,
      operator: transaction.operator as MobileMoneyOperator,
      phoneNumber: transaction.phoneNumber,
      amount: transaction.amount,
      currency: transaction.currency,
      externalTransactionId:
        providerResult.transactionId ?? transaction.externalTransactionId,
      completedAt: transaction.completedAt,
      paymentUrl: providerResult.paymentUrl,
      reference: providerResult.reference,
    };
  }

  /**
   * Confirme une transaction Mobile Money avec le code OTP.
   * Délègue la validation OTP au provider — identique staging et production.
   */
  async confirmTransaction(
    id: string,
    otp: string,
    accountId: string,
  ): Promise<MobileMoneyTransaction> {
    const transaction = await this.prisma.mobileMoneyTransaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new Error('Transaction non trouvée');
    }

    if (transaction.accountId !== accountId) {
      throw new Error(
        "Non autorisé - cette transaction n'appartient pas à ce compte",
      );
    }

    if (transaction.status !== 'pending') {
      throw new Error('Impossible de confirmer une transaction non-pending');
    }

    // Déléguer la validation OTP au provider (simulation: OTP ≥ 4 chars / NovaSend: appel API réel)
    const provider = this.paymentProviderFactory.getMobileMoneyProvider();
    const externalId = transaction.externalTransactionId || transaction.id;
    const providerResult = await provider.confirmPayment(externalId, otp);

    if (!providerResult.success) {
      const failedTransaction = await this.prisma.mobileMoneyTransaction.update(
        {
          where: { id },
          data: { status: 'failed' },
        },
      );

      return {
        transactionId: failedTransaction.id,
        id: failedTransaction.id,
        status: 'failed',
        createdAt: failedTransaction.createdAt,
        accountId: failedTransaction.accountId,
        userId: failedTransaction.userId,
        operator: failedTransaction.operator as MobileMoneyOperator,
        phoneNumber: failedTransaction.phoneNumber,
        amount: failedTransaction.amount,
        currency: failedTransaction.currency,
        externalTransactionId: failedTransaction.externalTransactionId,
        completedAt: failedTransaction.completedAt,
      };
    }

    const externalRef =
      providerResult.transactionId ||
      transaction.externalTransactionId ||
      `EXT-${Date.now()}-${randomInt(10000, 99999)}`;

    const completedTransaction =
      await this.prisma.mobileMoneyTransaction.update({
        where: { id },
        data: {
          status: 'completed',
          externalTransactionId: externalRef,
          completedAt: new Date(),
        },
      });

    await this.updateAccountBalance(accountId, completedTransaction.amount);

    return {
      transactionId: completedTransaction.id,
      id: completedTransaction.id,
      status: 'completed',
      createdAt: completedTransaction.createdAt,
      accountId: completedTransaction.accountId,
      userId: completedTransaction.userId,
      operator: completedTransaction.operator as MobileMoneyOperator,
      phoneNumber: completedTransaction.phoneNumber,
      amount: completedTransaction.amount,
      currency: completedTransaction.currency,
      externalTransactionId: completedTransaction.externalTransactionId,
      completedAt: completedTransaction.completedAt,
    };
  }

  /**
   * Interroge le provider pour le statut courant d'une transaction (polling).
   * Met à jour le solde si la transaction passe à "completed" (idempotent).
   */
  async pollTransactionStatus(
    id: string,
    accountId: string,
  ): Promise<{ status: 'completed' | 'pending' | 'failed' }> {
    const transaction = await this.prisma.mobileMoneyTransaction.findUnique({
      where: { id },
    });

    if (!transaction) throw new Error('Transaction introuvable');
    if (transaction.accountId !== accountId) throw new Error('Non autorisé');

    if (transaction.status === 'completed') return { status: 'completed' };
    if (transaction.status === 'failed') return { status: 'failed' };

    const provider = this.paymentProviderFactory.getMobileMoneyProvider();
    const ref = transaction.externalTransactionId || transaction.id;
    const providerResult = await provider.getStatus(ref);

    if (providerResult.status === 'completed') {
      await this.prisma.mobileMoneyTransaction.update({
        where: { id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await this.updateAccountBalance(accountId, transaction.amount);
      return { status: 'completed' };
    }

    if (providerResult.status === 'failed') {
      await this.prisma.mobileMoneyTransaction.update({
        where: { id },
        data: { status: 'failed' },
      });
      return { status: 'failed' };
    }

    return { status: 'pending' };
  }

  /**
   * Met à jour le solde du compte après une transaction réussie
   */
  private async updateAccountBalance(accountId: string, amount: Decimal) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error('Compte non trouvé');
    }

    await this.prisma.account.update({
      where: { id: accountId },
      data: { creditBalance: account.creditBalance.add(amount) },
    });

    this.logger.log(
      `Solde du compte ${accountId} mis à jour de ${amount.toString()}`,
    );
  }

  /**
   * Récupère une transaction par ID
   */
  async getTransactionById(
    id: string,
    accountId: string,
  ): Promise<MobileMoneyTransaction | null> {
    const transaction = await this.prisma.mobileMoneyTransaction.findUnique({
      where: { id },
    });

    if (!transaction || transaction.accountId !== accountId) {
      return null;
    }

    return {
      transactionId: transaction.id,
      id: transaction.id,
      status: transaction.status as
        | 'pending'
        | 'completed'
        | 'failed'
        | 'cancelled',
      createdAt: transaction.createdAt,
      accountId: transaction.accountId,
      userId: transaction.userId,
      operator: transaction.operator as MobileMoneyOperator,
      phoneNumber: transaction.phoneNumber,
      amount: transaction.amount,
      currency: transaction.currency,
      externalTransactionId: transaction.externalTransactionId,
      completedAt: transaction.completedAt,
    };
  }

  /**
   * Liste les transactions pour un compte
   */
  async listTransactions(
    accountId: string,
    pagination: { limit: number; offset: number },
  ): Promise<MobileMoneyTransaction[]> {
    const { limit, offset } = pagination;

    const transactions = await this.prisma.mobileMoneyTransaction.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return transactions.map((t) => ({
      transactionId: t.id,
      id: t.id,
      status: t.status as 'pending' | 'completed' | 'failed' | 'cancelled',
      createdAt: t.createdAt,
      accountId: t.accountId,
      userId: t.userId,
      operator: t.operator as MobileMoneyOperator,
      phoneNumber: t.phoneNumber,
      amount: t.amount,
      currency: t.currency,
      externalTransactionId: t.externalTransactionId,
      completedAt: t.completedAt,
    }));
  }

  /**
   * Liste les transactions pour un utilisateur
   */
  async listTransactionsByUser(
    userId: string,
    pagination: { limit: number; offset: number },
  ): Promise<MobileMoneyTransaction[]> {
    const { limit, offset } = pagination;

    const transactions = await this.prisma.mobileMoneyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return transactions.map((t) => ({
      transactionId: t.id,
      id: t.id,
      status: t.status as 'pending' | 'completed' | 'failed' | 'cancelled',
      createdAt: t.createdAt,
      accountId: t.accountId,
      userId: t.userId,
      operator: t.operator as MobileMoneyOperator,
      phoneNumber: t.phoneNumber,
      amount: t.amount,
      currency: t.currency,
      externalTransactionId: t.externalTransactionId,
      completedAt: t.completedAt,
    }));
  }

  /**
   * Génère un reçu PDF pour une transaction Mobile Money
   */
  async generateReceiptPdf(
    transactionId: string,
    accountId: string,
  ): Promise<Buffer> {
    const transaction = await this.prisma.mobileMoneyTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction || transaction.accountId !== accountId) {
      throw new Error('Transaction non trouvée ou accès non autorisé');
    }

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('NovaSMS — Reçu de paiement', { align: 'center' });
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      const statusColor: Record<string, string> = {
        completed: '#16a34a',
        pending: '#d97706',
        failed: '#dc2626',
        cancelled: '#6b7280',
      };
      const color = statusColor[transaction.status] || '#6b7280';
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor(color)
        .text(`Statut : ${transaction.status.toUpperCase()}`, {
          align: 'center',
        });
      doc.fillColor('#000000').moveDown();

      const fields: [string, string][] = [
        ['ID Transaction', transaction.id],
        ['Opérateur', transaction.operator],
        ['Numéro de téléphone', transaction.phoneNumber],
        ['Montant', `${transaction.amount.toString()} ${transaction.currency}`],
        [
          'Date de création',
          transaction.createdAt.toLocaleString('fr-FR', { timeZone: 'UTC' }),
        ],
        [
          'Date de complétion',
          transaction.completedAt
            ? transaction.completedAt.toLocaleString('fr-FR', {
                timeZone: 'UTC',
              })
            : 'N/A',
        ],
        ['Référence externe', transaction.externalTransactionId || 'N/A'],
        ['ID Compte', transaction.accountId],
      ];

      fields.forEach(([label, value]) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(`${label} :`, { continued: true });
        doc.font('Helvetica').fontSize(11).text(`  ${value}`);
        doc.moveDown(0.3);
      });

      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#6b7280')
        .text(
          `Document généré le ${new Date().toLocaleString('fr-FR', { timeZone: 'UTC' })} — NovaSMS`,
          { align: 'center' },
        );

      doc.end();
    });
  }

  /**
   * Liste les opérateurs supportés (WAVE, ORANGE, MOMO, MOOV)
   */
  getSupportedOperators(): { operator: MobileMoneyOperator; name: string }[] {
    return [
      { operator: 'WAVE', name: 'Wave' },
      { operator: 'ORANGE', name: 'Orange Money' },
      { operator: 'MOMO', name: 'MTN Mobile Money' },
      { operator: 'MOOV', name: 'Moov Money' },
    ];
  }
}
