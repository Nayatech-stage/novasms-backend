import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  private async resolveAccountId(accountId?: string) {
    if (accountId) return accountId;
    const account = await this.prisma.account.findFirst({
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException(
        'Aucun compte disponible pour enregistrer le template',
      );
    }
    return account.id;
  }

  async create(data: CreateTemplateDto) {
    const accountId = await this.resolveAccountId(data.accountId);
    // Auto-generate unique key if not provided
    const key =
      data.key && data.key.trim()
        ? data.key.trim()
        : `tpl-${accountId.slice(0, 8)}-${Date.now()}`;
    return this.prisma.template.create({
      data: {
        accountId,
        key,
        name: data.name ?? null,
        channelType: data.channelType ?? data.channel ?? null,
        htmlContent: data.htmlContent ?? data.contentHtml ?? null,
        contentText: data.contentText ?? null,
        variables: data.variables ?? undefined,
        createdBy: data.createdBy ?? null,
        isPreset: data.isPreset ?? false,
      },
    });
  }

  async findAll(page = 1, limit = 50, accountId?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    return this.prisma.template.findMany({
      where: accountId ? { accountId } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async findOne(id: string) {
    const t = await this.prisma.template.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async findByKey(key: string) {
    return this.prisma.template.findUnique({ where: { key } });
  }

  async update(id: string, data: UpdateTemplateDto) {
    await this.findOne(id);
    return this.prisma.template.update({
      where: { id },
      data: {
        name: data.name,
        channelType: data.channelType ?? data.channel,
        htmlContent: data.htmlContent ?? data.contentHtml,
        contentText: data.contentText,
        variables: data.variables ?? undefined,
        createdBy: data.createdBy,
        isPreset: data.isPreset,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.template.delete({ where: { id } });
  }
}
