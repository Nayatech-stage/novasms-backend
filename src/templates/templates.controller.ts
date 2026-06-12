import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Post()
  create(@Body() body: CreateTemplateDto) {
    return this.svc.create(body);
  }

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Get('key/:key')
  findByKey(@Param('key') key: string) {
    return this.svc.findByKey(key);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateTemplateDto) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/preview')
  async preview(
    @Param('id') id: string,
    @Body() vars: Record<string, unknown>,
  ) {
    const t = await this.svc.findOne(id);
    // simple token replacement for preview
    let html = t.htmlContent || '';
    let text = t.contentText || '';
    Object.keys(vars || {}).forEach((k) => {
      const re = new RegExp(`{{\\s*${k}\\s*}}`, 'g');
      html = html.replace(re, String(vars[k] ?? ''));
      text = text.replace(re, String(vars[k] ?? ''));
    });
    return { html, text };
  }
}
