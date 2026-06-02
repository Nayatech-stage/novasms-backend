import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant } from '../common/decorators/tenant.decorator';
import { AutomationsService } from './automations.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

@ApiTags('Automations')
@UseGuards(JwtAuthGuard)
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Post()
  @ApiOperation({ summary: 'Créer une automatisation simple' })
  async create(
    @Tenant() accountId: string | null,
    @Body() body: CreateAutomationDto,
  ) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.automationsService.createAutomation(accountId, body);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les automatisations du compte' })
  async list(@Tenant() accountId: string | null) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return { data: await this.automationsService.listAutomations(accountId) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une automatisation' })
  async detail(@Tenant() accountId: string | null, @Param('id') id: string) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.automationsService.getAutomation(accountId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une automatisation' })
  async update(
    @Tenant() accountId: string | null,
    @Param('id') id: string,
    @Body() body: UpdateAutomationDto,
  ) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.automationsService.updateAutomation(accountId, id, body);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Activer ou désactiver une automatisation' })
  async toggle(@Tenant() accountId: string | null, @Param('id') id: string) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.automationsService.toggleAutomation(accountId, id);
  }

  @Post(':id/trigger')
  @ApiOperation({
    summary: 'Déclencher manuellement une automatisation pour un contact',
  })
  async trigger(
    @Tenant() accountId: string | null,
    @Param('id') id: string,
    @Body() body: { contactId: string; delaySeconds?: number },
  ) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.automationsService.triggerAutomationForContact(
      accountId,
      id,
      body.contactId,
      body.delaySeconds,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer une automatisation' })
  async remove(@Tenant() accountId: string | null, @Param('id') id: string) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.automationsService.deleteAutomation(accountId, id);
  }

  @Get(':id/report')
  @ApiOperation({ summary: "Rapport d'exécution d'une automatisation" })
  async report(@Tenant() accountId: string | null, @Param('id') id: string) {
    if (!accountId)
      throw new BadRequestException('Utilisateur non authentifié');
    return this.automationsService.getAutomationReport(accountId, id);
  }
}
