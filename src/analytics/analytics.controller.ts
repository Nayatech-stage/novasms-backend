import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

type TenantRequest = Request & { accountId?: string };

@ApiTags('Analytics')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async overview(
    @Request() req: TenantRequest,
    @Query('period') period?: string,
  ) {
    const accountId = req.accountId as string;
    const days = period === '90' ? 90 : period === '7' ? 7 : 30;
    return this.analyticsService.getOverview(accountId, days);
  }

  @Get('summary')
  async summary(
    @Request() req: TenantRequest,
    @Query('period') period?: string,
  ) {
    const accountId = req.accountId as string;
    const days = period === '90' ? 90 : period === '7' ? 7 : 30;
    return this.analyticsService.getSummary(accountId, days);
  }

  @Get('activity')
  async activity(
    @Request() req: TenantRequest,
    @Query('limit') limit?: string,
  ) {
    const accountId = req.accountId as string;
    return this.analyticsService.getActivity(
      accountId,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get('campaign/:id/report')
  async campaignReport(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId as string;
    return this.analyticsService.getCampaignReport(accountId, id);
  }
}
