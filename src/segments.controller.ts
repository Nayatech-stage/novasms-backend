import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContactsService } from './contacts/contacts.service';
import { SegmentCreateSchema } from './contacts/dto/segment.dto';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

type TenantRequest = Request & { accountId?: string };

@ApiTags('Segments')
@Controller('segments')
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(private contactsService: ContactsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @Request() req: TenantRequest) {
    const accountId = (req as any).accountId;
    if (!accountId) throw new BadRequestException('accountId manquant');

    try {
      const parsed = SegmentCreateSchema.parse(body);
      const segment = await this.contactsService.createSegment(accountId, {
        name: parsed.name,
        logic: parsed.logic,
        criteria: parsed.criteria,
      });

      return {
        success: true,
        id: segment.id,
        segment,
        message: `Segment "${parsed.name}" cree pour ${segment.contactCount} contacts`,
      };
    } catch (e: any) {
      throw new BadRequestException({
        message: 'Echec creation',
        errors: e.errors || [e.message],
      });
    }
  }
}
