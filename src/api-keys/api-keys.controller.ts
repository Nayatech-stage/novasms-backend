import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApiKeysService,
  API_PERMISSIONS,
  ApiPermission,
} from './api-keys.service';
import type { Request as ExpressRequest } from 'express';

type TenantRequest = ExpressRequest & {
  accountId?: string;
  user?: { sub: string; email: string; accountId: string; role: string };
};

function requireAdmin(req: TenantRequest): void {
  if (req.user?.role !== UserRole.Admin) {
    throw new ForbiddenException('Accès réservé aux administrateurs');
  }
}

@ApiTags('API Keys')
@Controller('account/api-keys')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les clés API du compte' })
  async list(@Request() req: TenantRequest) {
    requireAdmin(req);
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.apiKeysService.listKeys(accountId);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Lister les permissions disponibles' })
  listPermissions() {
    return {
      permissions: API_PERMISSIONS.map((p) => ({
        value: p,
        label:
          {
            'contacts:read': 'Lire les contacts',
            'contacts:write': 'Créer/modifier des contacts',
            'sms:send': 'Envoyer des SMS',
            'email:send': 'Envoyer des emails',
            'campaigns:read': 'Lire les campagnes',
            'balance:read': 'Consulter le solde',
          }[p] ?? p,
      })),
    };
  }

  @Post()
  @ApiOperation({
    summary:
      'Générer une nouvelle clé API (la clé brute est retournée UNE SEULE FOIS)',
  })
  async create(
    @Body()
    body: { name: string; permissions: ApiPermission[]; expiresAt?: string },
    @Request() req: TenantRequest,
  ) {
    requireAdmin(req);
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.name?.trim())
      throw new BadRequestException('Le nom de la clé est requis');
    if (!Array.isArray(body.permissions) || body.permissions.length === 0) {
      throw new BadRequestException('Sélectionnez au moins une permission');
    }

    const validPerms = body.permissions.filter((p) =>
      (API_PERMISSIONS as readonly string[]).includes(p),
    ) as ApiPermission[];
    if (validPerms.length === 0)
      throw new BadRequestException('Permissions invalides');

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;

    return this.apiKeysService.createKey(
      accountId,
      body.name.trim(),
      validPerms,
      expiresAt,
    );
  }

  @Get(':id/stats')
  @ApiOperation({ summary: "Statistiques d'utilisation d'une clé API" })
  async stats(@Param('id') id: string, @Request() req: TenantRequest) {
    requireAdmin(req);
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    const result = await this.apiKeysService.getKeyStats(accountId, id);
    if (!result) throw new NotFoundException('Clé introuvable');
    return result;
  }

  @Post('send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envoyer une clé API par email au développeur' })
  async sendToDeveloper(
    @Body() body: { developerEmail: string; fullKey: string; keyName: string },
    @Request() req: TenantRequest,
  ) {
    requireAdmin(req);
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    if (!body.developerEmail?.includes('@'))
      throw new BadRequestException('Email invalide');
    if (!body.fullKey?.startsWith('nvsms_'))
      throw new BadRequestException('Clé invalide');
    return this.apiKeysService.sendKeyToDeveloper(accountId, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Révoquer une clé API' })
  async revoke(@Param('id') id: string, @Request() req: TenantRequest) {
    requireAdmin(req);
    const accountId = req.accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');
    return this.apiKeysService.revokeKey(accountId, id);
  }
}
