import {
  Body,
  Controller,
  Post,
  Request,
  Get,
  Param,
  Delete,
  Patch,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { FileUploadService } from './file-upload.service';
import type { Request as ExpressRequest } from 'express';
import type { Response } from 'express';
import type { Express } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

type TenantRequest = ExpressRequest & { accountId?: string };

@ApiTags('Campaigns')
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CampaignsController {
  constructor(
    private campaignsService: CampaignsService,
    private fileUploadService: FileUploadService,
  ) {}

  @Post()
  async create(@Body() body: unknown, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.campaignsService.create(accountId, body);
  }

  @Get()
  async list(@Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return { data: await this.campaignsService.list(accountId) };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.campaignsService.get(accountId, id);
  }

  @Delete(':id/schedule')
  async cancelSchedule(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.campaignsService.cancelScheduled(accountId, id);
  }

  @Post(':id/ab/evaluate')
  async evaluateWinner(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    return this.campaignsService.evaluateABWinner(id);
  }

  @Patch(':id/ab')
  async updateABConfig(
    @Param('id') id: string,
    @Body() body: { subjectA: string; subjectB: string; abSplitPct: number },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    // Appel au service au lieu d'accéder à this.prisma
    return this.campaignsService.updateABConfig(accountId, id, body);
  }

  @Get('analytics/best-send-time')
  async getBestSendTime(
    @Request() req: TenantRequest,
    @Query('segmentId') segmentId?: string,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');
    void segmentId;
    return this.campaignsService.getBestSendTime(accountId);
  }

  @Post('sms/calculate-cost')
  calculateSmsCost(@Body() body: { text: string; recipientCount: number }) {
    return this.campaignsService.calculateSmsCost(
      body.text,
      body.recipientCount,
    );
  }

  @Post(':campaignId/images/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @Param('campaignId') campaignId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    // Verify campaign belongs to account
    const campaign = await this.campaignsService.get(accountId, campaignId);
    if (!campaign) throw new Error('Campaign not found');

    return this.fileUploadService.uploadCampaignImage(campaignId, file);
  }

  @Get('images/:fileName')
  getImage(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      const imageBuffer = this.fileUploadService.getCampaignImage(fileName);
      res.set('Content-Type', 'image/jpeg'); // Can be updated based on stored mime type
      res.send(imageBuffer);
    } catch {
      res.status(404).json({ error: 'Image not found' });
    }
  }

  @Get(':campaignId/images')
  async getCampaignImages(
    @Param('campaignId') campaignId: string,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    // Verify campaign belongs to account
    const campaign = await this.campaignsService.get(accountId, campaignId);
    if (!campaign) throw new Error('Campaign not found');

    return this.fileUploadService.getCampaignImages(campaignId);
  }

  @Delete(':campaignId/images')
  async deleteAllImages(
    @Param('campaignId') campaignId: string,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    // Verify campaign belongs to account
    const campaign = await this.campaignsService.get(accountId, campaignId);
    if (!campaign) throw new Error('Campaign not found');

    await this.fileUploadService.deleteAllCampaignImages(campaignId);
    return { success: true };
  }

  @Post(':id/send')
  async sendCampaign(
    @Param('id') id: string,
    @Body()
    body: {
      immediateOrScheduled?: 'immediate' | 'scheduled';
      scheduledAt?: string;
    },
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    try {
      const campaign = await this.campaignsService.get(accountId, id);
      if (!campaign) {
        return { success: false, error: 'Campagne non trouvée' };
      }

      const immediateOrScheduled = body?.immediateOrScheduled || 'immediate';
      const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;

      if (immediateOrScheduled === 'scheduled' && !scheduledAt) {
        return { success: false, error: 'Date de programmation requise' };
      }

      const result = await this.campaignsService.sendCampaign(accountId, id, {
        immediateOrScheduled,
        scheduledAt: scheduledAt || undefined,
      });

      return result;
    } catch (error) {
      console.error('Send campaign error:', error);
      return {
        success: false,
        error: "Une erreur s'est produite. Veuillez réessayer.",
      };
    }
  }

  @Post(':id/save-draft')
  async saveDraft(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: TenantRequest,
  ) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    try {
      const result = await this.campaignsService.saveDraft(accountId, id, body);
      return { success: true, data: result, message: 'Brouillon sauvegardé' };
    } catch (error) {
      console.error('Save draft error:', error);
      return {
        success: false,
        error: "Une erreur s'est produite. Veuillez réessayer.",
      };
    }
  }

  @Post(':id/cancel')
  async cancelCampaign(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId;
    if (!accountId) throw new Error('accountId manquant');

    try {
      const campaign = await this.campaignsService.get(accountId, id);
      if (!campaign) {
        return { success: false, error: 'Campagne non trouvée' };
      }

      // Can only cancel DRAFT or SCHEDULED
      if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
        return {
          success: false,
          error: `Impossible d'annuler une campagne ${campaign.status.toLowerCase()}`,
        };
      }

      const result = await this.campaignsService.cancelCampaign(accountId, id);
      return {
        success: true,
        message: 'Campagne annulée',
        data: result,
      };
    } catch (error) {
      console.error('Cancel campaign error:', error);
      return {
        success: false,
        error: "Une erreur s'est produite. Veuillez réessayer.",
      };
    }
  }
}
