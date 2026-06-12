import {
  Controller,
  Post,
  Get,
  UseGuards,
  Body,
  Param,
  Request,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MobileMoneyService } from './mobile-money.service';
import type { Request as ExpressRequest } from 'express';

type OperatorKey = 'WAVE' | 'ORANGE' | 'MOMO' | 'MOOV';

const OPERATOR_RULES: Record<
  OperatorKey,
  { min: number; max: number; prefixes: string[] }
> = {
  WAVE: { min: 500, max: 500_000, prefixes: ['01', '05', '07', '27'] },
  ORANGE: {
    min: 500,
    max: 300_000,
    prefixes: [
      '05',
      '07',
      '25',
      '45',
      '47',
      '57',
      '65',
      '67',
      '77',
      '87',
      '97',
    ],
  },
  MOMO: { min: 500, max: 500_000, prefixes: ['05', '25', '45', '65'] },
  MOOV: { min: 500, max: 300_000, prefixes: ['01', '41', '61'] },
};

function validatePayment(
  operator: string,
  phoneNumber: string,
  amount: number,
): void {
  // Amount bounds
  const rules = OPERATOR_RULES[operator as OperatorKey];
  const min = rules?.min ?? 500;
  const max = rules?.max ?? 1_000_000;
  if (amount < min) {
    throw new BadRequestException(`Amount minimum for ${operator}: ${min} XOF`);
  }
  if (amount > max) {
    throw new BadRequestException(`Amount maximum for ${operator}: ${max} XOF`);
  }

  // Phone format — CI only (skip for NOVASEND)
  if (!rules) return;
  const digits = phoneNumber.replace(/\D/g, '');
  const local = digits.startsWith('225') ? digits.slice(3) : digits;
  if (local.length !== 10) {
    throw new BadRequestException(
      'Phone must be 10 digits (CI format: +225 07 XX XX XX XX)',
    );
  }
  const prefix = local.slice(0, 2);
  if (!rules.prefixes.includes(prefix)) {
    throw new BadRequestException(
      `Phone prefix ${prefix} does not match operator ${operator}. Expected: ${rules.prefixes.join(', ')}`,
    );
  }
}

// Type étendu pour accéder à accountId injecté par TenantInterceptor
type TenantRequest = ExpressRequest & {
  accountId?: string;
  user?: { accountId?: string; email?: string };
};

@ApiTags('Mobile Money')
@Controller('mobile-money')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MobileMoneyController {
  constructor(private mobileMoneyService: MobileMoneyService) {}

  @Post('initiate')
  @ApiOperation({
    summary: 'Initier une transaction Mobile Money - RG-46, RG-47',
  })
  async initiateTransaction(
    @Body()
    body: {
      operator: 'WAVE' | 'ORANGE' | 'MOMO' | 'MOOV';
      phoneNumber: string;
      amount: number;
      currency?: string;
      description?: string;
      otp?: string; // Orange Money : code via #144*82#
      country?: string; // ISO : CI | CM (defaut CI)
      customerName?: string;
    },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;

    if (!accountId) {
      throw new Error(
        'accountId manquant — vérifiez que JwtAuthGuard et TenantInterceptor sont actifs',
      );
    }

    const userId = req.user?.accountId ?? accountId;

    const {
      operator,
      phoneNumber,
      amount,
      currency = 'XOF',
      description = 'Recharge crédit NovaSMS',
      otp,
      country = 'CI',
      customerName,
    } = body;

    // Validate phone format and amount bounds before hitting the provider
    validatePayment(operator, phoneNumber, amount);

    // Orange Money requires an OTP
    if (operator === 'ORANGE') {
      if (!otp || !/^\d{4}$/.test(otp)) {
        throw new BadRequestException(
          'Orange Money requires a 4-digit OTP (dial #144*82# to get it)',
        );
      }
    }

    const transaction = await this.mobileMoneyService.initiateTransaction({
      userId: String(userId),
      userEmail: req.user?.email,
      accountId: String(accountId),
      operator,
      phoneNumber,
      amount,
      currency,
      description,
      otp,
      country,
      customerName,
    });

    const messages: Record<string, string> = {
      WAVE: 'Ouvrez votre application Wave pour confirmer le paiement.',
      ORANGE: 'Paiement Orange Money en cours de traitement.',
      MOMO: 'Confirmez le paiement via votre application MTN MoMo ou composez *133#.',
      MOOV: 'Confirmez le paiement via Moov Money ou composez *155#.',
    };

    return {
      success: true,
      transactionId: transaction.id,
      paymentUrl: transaction.paymentUrl ?? null,
      reference: transaction.reference ?? null,
      message: messages[operator] ?? `Transaction initiée avec succès.`,
      transaction,
    };
  }

  @Get(':id/status')
  @ApiParam({ name: 'id', description: 'ID interne de la transaction' })
  @ApiOperation({ summary: 'Polling du statut de paiement — RG-48' })
  async pollStatus(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const result = await this.mobileMoneyService.pollTransactionStatus(
      id,
      String(accountId),
    );
    return { success: true, ...result };
  }

  @Post(':id/confirm')
  @ApiParam({ name: 'id', description: 'ID de la transaction à confirmer' })
  @ApiOperation({
    summary: 'Confirmer une transaction Mobile Money avec le code OTP - RG-47',
  })
  async confirmTransaction(
    @Param('id') id: string,
    @Body() body: { otp: string },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) {
      throw new Error(
        'accountId manquant — vérifiez que JwtAuthGuard et TenantInterceptor sont actifs',
      );
    }

    const { otp } = body;

    // Confirmation de la transaction
    const transaction = await this.mobileMoneyService.confirmTransaction(
      id,
      otp,
      String(accountId),
    );

    if (transaction.status === 'completed') {
      return {
        success: true,
        message:
          'Transaction confirmée avec succès. Vos crédits ont été mis à jour.',
        transaction,
      };
    } else {
      return {
        success: false,
        message: 'Échec de la confirmation. Veuillez réessayer.',
        transaction,
      };
    }
  }

  @Get('transactions')
  @ApiOperation({
    summary: "Lister les transactions Mobile Money d'un compte - RG-44",
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Nombre de résultats à retourner',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Nombre de résultats à ignorer (pagination)',
  })
  async listTransactions(
    @Request() req: TenantRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const accountId = req.accountId;
    if (!accountId) {
      throw new Error(
        'accountId manquant — vérifiez que JwtAuthGuard et TenantInterceptor sont actifs',
      );
    }

    const transactions = await this.mobileMoneyService.listTransactions(
      String(accountId),
      {
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      },
    );

    return { transactions };
  }

  @Get('transactions/:id/receipt')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Télécharger le reçu PDF d'une transaction Mobile Money",
  })
  @ApiParam({ name: 'id', description: 'ID de la transaction' })
  async downloadReceipt(
    @Param('id') id: string,
    @Request() req: TenantRequest,
    @Res() res: Response,
  ) {
    const accountId = req.accountId;
    if (!accountId) {
      throw new Error('accountId manquant');
    }
    const pdfBuffer = await this.mobileMoneyService.generateReceiptPdf(
      id,
      String(accountId),
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }
}
