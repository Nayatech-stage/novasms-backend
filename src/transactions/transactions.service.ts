import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { StripeProvider } from '../providers/payment/stripe.provider';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly stripe: StripeProvider | null;

  constructor(private readonly prisma: PrismaService) {
    // Initialiser Stripe seulement si la clé est configurée
    this.stripe = process.env.STRIPE_SECRET_KEY ? new StripeProvider() : null;

    if (!this.stripe) {
      this.logger.warn(
        'STRIPE_SECRET_KEY non configuré — paiement Visa en mode simulation',
      );
    }
  }

  /**
   * RG-48 — Paiement par carte Visa.
   * Si STRIPE_SECRET_KEY est configuré : charge réelle via Stripe PaymentIntents.
   * Sinon : simulation (développement uniquement).
   */
  async processVisa(params: {
    accountId: string;
    amount: number;
    cardName: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvv: string;
    /** Stripe PaymentMethod ID généré par Stripe.js côté front */
    paymentMethodId?: string;
  }): Promise<{
    transactionId: string;
    status: string;
    requiresAction?: boolean;
    clientSecret?: string;
  }> {
    const { accountId, amount, paymentMethodId } = params;

    if (amount < 1000) throw new Error('Montant minimum 1 000 FCFA');

    // --- Flux Stripe réel ---
    if (this.stripe) {
      const result = await this.stripe.charge({
        amount,
        description: `Recharge NovaSMS — compte ${accountId}`,
        paymentMethodId,
      });

      if (result.requiresAction) {
        // 3D Secure requis — renvoyer le clientSecret au front pour confirmation
        return {
          transactionId: result.transactionId ?? '',
          status: 'requires_action',
          requiresAction: true,
          clientSecret: result.clientSecret,
        };
      }

      if (!result.success) {
        throw new Error(result.error ?? 'Paiement Stripe refusé');
      }

      // Stripe a confirmé le paiement — enregistrer en DB et créditer
      const transaction = await this.prisma.transaction.create({
        data: {
          accountId,
          amount: new Decimal(amount),
          method: 'Visa',
          reference:
            result.transactionId ??
            `STRIPE-${randomUUID().slice(0, 8).toUpperCase()}`,
          status: 'Validated',
        },
      });

      await this.prisma.account.update({
        where: { id: accountId },
        data: { creditBalance: { increment: new Decimal(amount) } },
      });

      await this.prisma.invoice.create({
        data: { transactionId: transaction.id, s3Path: null },
      });

      return { transactionId: transaction.id, status: 'Validated' };
    }

    // --- Mode simulation (dev sans STRIPE_SECRET_KEY) ---
    this.logger.warn(
      `Visa simulation pour compte ${accountId} — ${amount} FCFA`,
    );

    const transaction = await this.prisma.transaction.create({
      data: {
        accountId,
        amount: new Decimal(amount),
        method: 'Visa',
        reference: `VISA-SIM-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        status: 'Validated',
      },
    });

    await this.prisma.account.update({
      where: { id: accountId },
      data: { creditBalance: { increment: new Decimal(amount) } },
    });

    await this.prisma.invoice.create({
      data: { transactionId: transaction.id, s3Path: null },
    });

    return { transactionId: transaction.id, status: 'Validated' };
  }

  /** RG-51 — Génération du reçu PDF (pdfkit) */
  async generateReceipt(
    transactionId: string,
    accountId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, accountId },
      include: { invoice: true },
    });

    if (!transaction) throw new Error('Transaction introuvable');

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    const ref = transaction.reference ?? transaction.id;
    const dateStr = new Date(transaction.createdAt).toLocaleString('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const amountStr = `${Number(transaction.amount).toLocaleString('fr-FR')} FCFA`;

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── En-tête ──────────────────────────────────────────────────────────────
      doc
        .fontSize(28)
        .fillColor('#0c5460')
        .font('Helvetica-Bold')
        .text('NovaSMS', 50, 50);
      doc
        .fontSize(10)
        .fillColor('#6b7280')
        .font('Helvetica')
        .text('Plateforme de messagerie multi-canal', 50, 85);

      doc
        .moveTo(50, 110)
        .lineTo(545, 110)
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .stroke();

      doc
        .fontSize(20)
        .fillColor('#1a1a1a')
        .font('Helvetica-Bold')
        .text('Reçu de paiement', 50, 130);

      // Badge statut
      doc.roundedRect(400, 128, 95, 22, 11).fillColor('#d1fae5').fill();
      doc
        .fontSize(10)
        .fillColor('#065f46')
        .font('Helvetica-Bold')
        .text(`✓ ${transaction.status}`, 410, 133);

      // ── Bloc méta ────────────────────────────────────────────────────────────
      doc.roundedRect(50, 170, 495, 120, 8).fillColor('#f7f9f7').fill();

      const metaRows: [string, string][] = [
        ['Référence', ref],
        ['Date', dateStr],
        ['Mode de paiement', transaction.method ?? 'N/A'],
        ['Compte', account?.adminEmail ?? accountId],
      ];

      metaRows.forEach(([label, value], i) => {
        const y = 185 + i * 24;
        doc
          .fontSize(10)
          .fillColor('#6b7280')
          .font('Helvetica')
          .text(label, 70, y);
        doc
          .fontSize(10)
          .fillColor('#1a1a1a')
          .font('Helvetica-Bold')
          .text(value, 230, y);
      });

      // ── Montant ──────────────────────────────────────────────────────────────
      doc
        .fontSize(36)
        .fillColor('#0c5460')
        .font('Helvetica-Bold')
        .text(amountStr, 50, 315, { align: 'center' });

      // ── Message de confirmation ───────────────────────────────────────────────
      doc
        .fontSize(11)
        .fillColor('#374151')
        .font('Helvetica')
        .text(
          'Ce paiement a été validé et vos crédits ont été ajoutés instantanément à votre compte NovaSMS.',
          50,
          375,
          { align: 'center', width: 495 },
        );

      // ── Pied de page ─────────────────────────────────────────────────────────
      doc
        .moveTo(50, 420)
        .lineTo(545, 420)
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .stroke();

      doc
        .fontSize(9)
        .fillColor('#9ca3af')
        .font('Helvetica')
        .text(
          'Ce reçu est généré automatiquement par NovaSMS et constitue votre justificatif de paiement.',
          50,
          432,
          { align: 'center', width: 495 },
        )
        .text('Support : support@novasms.ci', 50, 447, {
          align: 'center',
          width: 495,
        })
        .text("NovaSMS SAS · Abidjan, Côte d'Ivoire", 50, 462, {
          align: 'center',
          width: 495,
        });

      doc.end();
    });

    return { buffer, filename: `recu-${ref}.pdf` };
  }

  async listTransactions(accountId: string, page = 1, limit = 20) {
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { invoice: true },
      }),
      this.prisma.transaction.count({ where: { accountId } }),
    ]);
    return { transactions, total, page, limit };
  }
}
