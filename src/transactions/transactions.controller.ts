import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Request,
  Res,
  UseGuards,
  Query,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionsService } from './transactions.service';
import type { Request as ExpressRequest, Response } from 'express';

type TenantRequest = ExpressRequest & { accountId?: string };

@ApiTags('Transactions')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  /** EN-1703 · RG-48 — Paiement par carte Visa */
  @Post('visa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Payer par carte Visa — EN-1703 RG-48' })
  async payVisa(
    @Body()
    body: {
      amount: number;
      cardName: string;
      cardNumber: string;
      expiryMonth: string;
      expiryYear: string;
      cvv: string;
    },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    const result = await this.transactionsService.processVisa({
      accountId: String(accountId),
      ...body,
    });
    return { success: true, ...result };
  }

  /** EN-1705 · RG-51 — Télécharger le reçu PDF */
  @Get(':id/receipt')
  @ApiOperation({ summary: 'Télécharger le reçu PDF — EN-1705 RG-51' })
  async downloadReceipt(
    @Param('id') id: string,
    @Request() req: TenantRequest,
    @Res() res: Response,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    const { buffer, filename } = await this.transactionsService.generateReceipt(
      id,
      String(accountId),
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  /** Historique des transactions */
  @Get()
  @ApiOperation({ summary: 'Lister les transactions du compte' })
  async listTransactions(
    @Request() req: TenantRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.transactionsService.listTransactions(
      String(accountId),
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
