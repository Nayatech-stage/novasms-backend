import { Injectable, NotFoundException } from '@nestjs/common';
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

  async create(data: any) {
    const accountId = await this.resolveAccountId(data.accountId);
    return this.prisma.template.create({
      data: {
        accountId,
        key: data.key,
        name: data.name,
        channelType: data.channelType ?? data.channel ?? null,
        htmlContent: data.htmlContent ?? data.contentHtml ?? null,
        contentText: data.contentText ?? null,
        variables: data.variables ?? null,
        createdBy: data.createdBy ?? null,
        isPreset: data.isPreset ?? false,
      },
    });
  }

  async findAll() {
    return this.prisma.template.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const t = await this.prisma.template.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async findByKey(key: string) {
    return this.prisma.template.findUnique({ where: { key } });
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.template.update({
      where: { id },
      data: {
        name: data.name,
        channelType: data.channelType ?? data.channel,
        htmlContent: data.htmlContent ?? data.contentHtml,
        contentText: data.contentText,
        variables: data.variables,
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
