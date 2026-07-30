import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderFactory } from '../providers/payment/payment.provider.factory';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class MobileMoneyReconciliationService {
  private readonly logger = new Logger(MobileMoneyReconciliationService.name);

  constructor(
    private prisma: PrismaService,
    private paymentProviderFactory: PaymentProviderFactory,
  ) {}

  /**
   * Toutes les 30 min : re-vérifie les transactions "pending" depuis plus de 15 min.
   * Crédite le compte si NovaSend confirme que le paiement est "processed".
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcilePendingTransactions() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago

    const pending = await this.prisma.mobileMoneyTransaction.findMany({
      where: {
        status: 'pending',
        createdAt: { lte: cutoff },
        externalTransactionId: { not: null },
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) return;

    this.logger.log(
      `[Reconciliation] ${pending.length} transaction(s) pending à vérifier`,
    );

    const provider = this.paymentProviderFactory.getMobileMoneyProvider();

    for (const tx of pending) {
      try {
        const result = await provider.getStatus(tx.externalTransactionId!);

        if (result.status === 'completed') {
          const updated = await this.prisma.mobileMoneyTransaction.updateMany({
            where: { id: tx.id, status: 'pending' },
            data: { status: 'completed', completedAt: new Date() },
          });

          if (updated.count > 0) {
            await this.prisma.account.update({
              where: { id: tx.accountId },
              data: { creditBalance: { increment: tx.amount } },
            });
            this.logger.log(
              `[Reconciliation] ✅ TX ${tx.id} → completed, compte ${tx.accountId} crédité de ${tx.amount}`,
            );
          }
        } else if (result.status === 'failed') {
          await this.prisma.mobileMoneyTransaction.update({
            where: { id: tx.id },
            data: { status: 'failed' },
          });
          this.logger.warn(
            `[Reconciliation] ❌ TX ${tx.id} → failed sur NovaSend`,
          );
        }
        // 'pending' → on laisse pour le prochain cycle
      } catch (err) {
        this.logger.error(
          `[Reconciliation] Erreur sur TX ${tx.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Endpoint appelé par le webhook NovaSend.
   * Crédite le compte si le paiement est confirmé.
   */
  async handleWebhook(payload: {
    id: string;
    reference: string;
    status: string;
    failure?: unknown;
  }): Promise<{ processed: boolean }> {
    const { id: externalId, status, failure } = payload;

    if (status !== 'processed' || failure) {
      this.logger.warn(
        `[Webhook] TX externe ${externalId} → status=${status}, ignoré`,
      );
      return { processed: false };
    }

    // Chercher par externalTransactionId (NovaSend id: tr_xxx)
    const tx = await this.prisma.mobileMoneyTransaction.findFirst({
      where: { externalTransactionId: externalId, status: 'pending' },
    });

    if (!tx) {
      this.logger.warn(
        `[Webhook] TX externe ${externalId} introuvable ou déjà traitée`,
      );
      return { processed: false };
    }

    const updated = await this.prisma.mobileMoneyTransaction.updateMany({
      where: { id: tx.id, status: 'pending' },
      data: { status: 'completed', completedAt: new Date() },
    });

    if (updated.count > 0) {
      await this.prisma.account.update({
        where: { id: tx.accountId },
        data: { creditBalance: { increment: tx.amount as Decimal } },
      });
      this.logger.log(
        `[Webhook] ✅ TX ${tx.id} (externe ${externalId}) → completed, compte ${tx.accountId} crédité de ${tx.amount}`,
      );
      return { processed: true };
    }

    return { processed: false };
  }
}
