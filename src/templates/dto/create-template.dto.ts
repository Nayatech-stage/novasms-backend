import type { Prisma } from '@prisma/client';

export class CreateTemplateDto {
  accountId?: string;
  key: string;
  name: string;
  channelType?: string;
  channel?: string;
  htmlContent?: string;
  contentHtml?: string;
  contentText?: string;
  variables?: Prisma.InputJsonValue;
  createdBy?: string;
  isPreset?: boolean;
}
