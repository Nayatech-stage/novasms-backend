import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomInt } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import PDFDocument from 'pdfkit';

export type MobileMoneyOperator = 'ORANGE' | 'MTN';

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
  accountId: string;
  operator: MobileMoneyOperator;
  phoneNumber: string;
  amount: number;
  currency: string;
  description?: string;
};

@Injectable()
export class MobileMoneyService {
  constructor(private prisma: PrismaService) {}

  private readonly logger = new Logger(MobileMoneyService.name);

  /**
   * US-017: Résoudre l'URL de l'opérateur selon l'environnement (staging vs production)
   */
  private resolveOperatorUrl(operator: MobileMoneyOperator): string {
    const isProd = process.env.NODE_ENV === 'production';
    const urls: Record<MobileMoneyOperator, { prod: string; staging: string }> =
      {
        ORANGE: {
          prod:
            process.env.MM_ORANGE_PROD_URL ||
            'https://api.orange.com/orange-money-webpay/v1',
          staging:
            process.env.MM_ORANGE_STAGING_URL ||
            'https://apiw.orange.com/orange-money-webpay/dev/v1',
        },
        MTN: {
          prod:
            process.env.MM_MTN_PROD_URL ||
            'https://proxy.momoapi.mtn.com/collection/v1_0',
          staging:
            process.env.MM_MTN_STAGING_URL ||
            'https://sandbox.momodeveloper.mtn.com/collection/v1_0',
        },
      };
    return isProd ? urls[operator].prod : urls[operator].staging;
  }

  /**
   * Initie une transaction Mobile Money
   * NOTE: Dans un vrai système, ceci appellerait l'API de l'opérateur via resolveOperatorUrl()
   */
  async initiateTransaction(
    params: InitiateTransactionParams,
  ): Promise<MobileMoneyTransaction> {
    const { userId, accountId, operator, phoneNumber, amount, currency } =
      params;

    // Validation de base
    if (amount <= 0) {
      throw new Error('Le montant doit être supérieur à 0');
    }

    // Générer un ID de transaction interne
    const internalTransactionId = `MM-${Date.now()}-${randomInt(10000, 99999)}`;

    // Créer l'enregistrement dans notre base
    const transaction = await this.prisma.mobileMoneyTransaction.create({
      data: {
        id: internalTransactionId,
        status: 'pending',
        userId,
        accountId,
        operator,
        phoneNumber,
        amount: new Decimal(amount),
        currency,
      },
    });

    // Retourner une transaction avec tous les champs requis
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
   * Confirme une transaction Mobile Money avec le code OTP
   * NOTE: Dans un vrai système, ceci appellerait l'API de l'opérateur
   */
  async confirmTransaction(
    id: string,
    otp: string,
    accountId: string,
  ): Promise<MobileMoneyTransaction> {
    // Récupérer la transaction
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

    // US-017: validation OTP via l'API opérateur selon l'environnement
    // En production, appel réel à resolveOperatorUrl(operator). En dev/staging, validation par longueur (6 chiffres).
    const isProd = process.env.NODE_ENV === 'production';
    const isValidOtp = isProd
      ? otp.length === 6 && /^\d{6}$/.test(otp) // placeholder prod — remplacer par appel API opérateur
      : otp.length >= 4; // staging: accept any 4+ char OTP

    if (!isValidOtp) {
      // Marquer la transaction comme échouée
      const failedTransaction = await this.prisma.mobileMoneyTransaction.update(
        {
          where: { id },
          data: { status: 'failed' },
        },
      );

      return {
        transactionId: failedTransaction.id,
        id: failedTransaction.id,
        status: failedTransaction.status as
          | 'pending'
          | 'completed'
          | 'failed'
          | 'cancelled',
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

    // Simulation d'un appel réussi à l'API de l'opérateur
    // Ici, on considère que la transaction est réussie
    const completedTransaction =
      await this.prisma.mobileMoneyTransaction.update({
        where: { id },
        data: {
          status: 'completed',
          externalTransactionId: `EXT-${Date.now()}-${randomInt(10000, 99999)}`,
          completedAt: new Date(),
        },
      });

    // Mettre à jour le solde du compte
    await this.updateAccountBalance(accountId, completedTransaction.amount);

    return {
      transactionId: completedTransaction.id,
      id: completedTransaction.id,
      status: completedTransaction.status as
        | 'pending'
        | 'completed'
        | 'failed'
        | 'cancelled',
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
   * Met à jour le solde du compte après une transaction réussie
   */
  private async updateAccountBalance(accountId: string, amount: Decimal) {
    // Récupérer le compte
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error('Compte non trouvé');
    }

    // Mettre à jour le solde (ajouter le montant rechargeé)
    await this.prisma.account.update({
      where: { id: accountId },
      data: {
        creditBalance: account.creditBalance.add(amount),
      },
    });

    this.logger.log(
      `Solde du compte ${accountId} mis à jour de ${amount.toString()}`,
    );
  }

  /**
   * Validate phone number format for West African countries
   */
  private isValidPhoneNumber(phoneNumber: string): boolean {
    // Remove any spaces or special characters
    const cleanNumber = phoneNumber.replace(/\s+/g, '');

    // Check if it matches standard West African phone formats
    const westAfricanPattern = /^(\+22[1-9]|0022[1-9])\d{7}$/;
    const localPattern = /^0[1-9]\d{7}$/;

    return (
      westAfricanPattern.test(cleanNumber) || localPattern.test(cleanNumber)
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
   * US-017: Reçu PDF pour paiements Mobile Money
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

      // En-tête
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('NovaSMS — Reçu de paiement', { align: 'center' });
      doc.moveDown();

      // Ligne séparatrice
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // Statut badge
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

      // Détails sous forme tableau simple
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
   * Get supported operators
  /**
   * Liste les opérateurs supportés
   */
  getSupportedOperators(): { operator: MobileMoneyOperator; name: string }[] {
    return [
      { operator: 'ORANGE', name: 'Orange Money' },
      { operator: 'MTN', name: 'MTN Mobile Money' },
    ];
  }
}
