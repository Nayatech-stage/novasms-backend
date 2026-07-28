import {
  BadRequestException,
  Controller,
  Post,
  Get,
  UseGuards,
  Body,
  Param,
  Request,
  Query,
  Res,
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
import { MobileMoneyService, OPERATOR_MESSAGES } from './mobile-money.service';
import type { Request as ExpressRequest } from 'express';

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
      otp?: string;
      country?: string;
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

    this.mobileMoneyService.validatePayment(operator, phoneNumber, amount, otp);

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

    return {
      success: true,
      transactionId: transaction.id,
      paymentUrl: transaction.paymentUrl ?? null,
      reference: transaction.reference ?? null,
      message:
        OPERATOR_MESSAGES[operator] ?? 'Transaction initiée avec succès.',
      transaction,
    };
  }

  @Post('session')
  @ApiOperation({
    summary:
      'Créer une session de paiement NovaSend (tous opérateurs, sans OTP)',
  })
  async createSession(
    @Body()
    body: {
      phoneNumber: string;
      amount: number;
      customerName?: string;
      country?: string;
      currency?: string;
      operator?: 'WAVE' | 'ORANGE' | 'MOMO' | 'MOOV';
    },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    const transaction = await this.mobileMoneyService.createPaymentSession({
      userId: String(req.user?.accountId ?? accountId),
      userEmail: req.user?.email,
      accountId: String(accountId),
      phoneNumber: body.phoneNumber,
      amount: body.amount,
      customerName: body.customerName,
      country: body.country ?? 'CI',
      currency: body.currency ?? 'XOF',
      operator: body.operator,
    });

    return {
      success: true,
      transactionId: transaction.id,
      paymentUrl: transaction.paymentUrl ?? null,
      reference: transaction.reference ?? null,
      message:
        'Session créée. Redirigez le client vers paymentUrl pour confirmer le paiement.',
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

    const transaction = await this.mobileMoneyService.confirmTransaction(
      id,
      body.otp,
      String(accountId),
    );

    if (transaction.status === 'completed') {
      return {
        success: true,
        message:
          'Transaction confirmée avec succès. Vos crédits ont été mis à jour.',
        transaction,
      };
    }
    return {
      success: false,
      message: 'Échec de la confirmation. Veuillez réessayer.',
      transaction,
    };
  }

  @Get('transactions')
  @ApiOperation({
    summary: "Lister les transactions Mobile Money d'un compte - RG-44",
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
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
    if (!accountId) throw new Error('accountId manquant');

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
