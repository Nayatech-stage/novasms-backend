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

// Type étendu pour accéder à accountId injecté par TenantInterceptor
type TenantRequest = ExpressRequest & { accountId?: string };

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
      operator: 'ORANGE' | 'MTN';
      phoneNumber: string;
      amount: number;
      currency?: string;
      description?: string;
    },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;

    if (!accountId) {
      throw new Error(
        'accountId manquant — vérifiez que JwtAuthGuard et TenantInterceptor sont actifs',
      );
    }

    // userId peut être extrait de req.user ou accountId - utilisons juste accountId
    const userId = accountId;

    const {
      operator,
      phoneNumber,
      amount,
      currency = 'XOF',
      description = 'Recharge crédit NovaSMS',
    } = body;

    const transaction = await this.mobileMoneyService.initiateTransaction({
      userId: String(userId), // Conversion en string
      accountId: String(accountId), // Conversion en string
      operator,
      phoneNumber,
      amount,
      currency,
      description,
    });

    return {
      success: true,
      transactionId: transaction.id,
      message: `Transaction initiée avec succès. Veuillez confirmer via votre application ${operator}.`,
      transaction,
    };
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
