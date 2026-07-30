import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';
import type { Prisma } from '@prisma/client';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  channelType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  channel?: string;

  @IsOptional()
  @IsString()
  htmlContent?: string;

  @IsOptional()
  @IsString()
  contentHtml?: string;

  @IsOptional()
  @IsString()
  contentText?: string;

  @IsOptional()
  @IsObject()
  variables?: Prisma.InputJsonValue;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  createdBy?: string;

  @IsOptional()
  @IsBoolean()
  isPreset?: boolean;
}
