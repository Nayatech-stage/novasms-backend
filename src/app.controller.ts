import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Santé API')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('api/health')
  @ApiOperation({ summary: 'Health check simple' })
  @ApiResponse({ status: 200, description: 'API is running' })
  getHealth(): string {
    return this.appService.getHealth();
  }

  @Get('api/status')
  @ApiOperation({ summary: 'Status détaillé' })
  @ApiResponse({ status: 200, description: 'Statut de l API' })
  getStatus(): object {
    return this.appService.getStatus();
  }

  @Get()
  @ApiOperation({ summary: 'Page d accueil API' })
  @ApiResponse({ status: 200, description: 'Bienvenue sur NovaSMS API' })
  getWelcome(): string {
    return 'Bienvenue sur NovaSMS API v1.0';
  }
}
