import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type AuthenticatedRequest = Request & { user: { accountId: string } };
import { SegmentsService, type SegmentCriteria } from './segments.service';

@Controller('segments')
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  /** POST /segments — Créer un segment */
  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Body() body: { name: string; criteria: SegmentCriteria },
  ) {
    return this.segmentsService.create(req.user.accountId, body);
  }

  /** GET /segments — Lister les segments du compte */
  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.segmentsService.findAll(req.user.accountId);
  }

  /** POST /segments/preview — Aperçu du nombre de contacts en temps réel */
  @Post('preview')
  previewCount(
    @Request() req: AuthenticatedRequest,
    @Body() criteria: SegmentCriteria,
  ) {
    return this.segmentsService.previewCount(req.user.accountId, criteria);
  }

  /** GET /segments/:id — Détail d'un segment */
  @Get(':id')
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.segmentsService.findOne(req.user.accountId, id);
  }

  /** PATCH /segments/:id — Modifier un segment */
  @Patch(':id')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; criteria?: SegmentCriteria },
  ) {
    return this.segmentsService.update(req.user.accountId, id, body);
  }

  /** DELETE /segments/:id — Supprimer un segment */
  @Delete(':id')
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.segmentsService.remove(req.user.accountId, id);
  }

  /** POST /segments/:id/refresh — Rafraîchir le compteur de contacts */
  @Post(':id/refresh')
  refresh(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.segmentsService.refreshCount(req.user.accountId, id);
  }
}
