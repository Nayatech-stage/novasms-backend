import { Controller, Get, Param, Request } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';

type TenantRequest = Request & { accountId?: string };

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async overview(@Request() req: TenantRequest) {
    const accountId = req.accountId as string;
    return this.analyticsService.getOverview(accountId);
  }

  @Get('campaign/:id/report')
  async campaignReport(@Param('id') id: string, @Request() req: TenantRequest) {
    const accountId = req.accountId as string;
    return this.analyticsService.getCampaignReport(accountId, id);
  }
}
