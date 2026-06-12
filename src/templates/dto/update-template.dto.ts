import type { Prisma } from '@prisma/client';

export class UpdateTemplateDto {
  name?: string;
  channelType?: string;
  channel?: string;
  htmlContent?: string;
  contentHtml?: string;
  contentText?: string;
  variables?: Prisma.InputJsonValue;
  createdBy?: string;
  isPreset?: boolean;
}
