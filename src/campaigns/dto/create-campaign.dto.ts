import {
  IsString,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum CampaignType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}
export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  CANCELLED = 'CANCELLED',
}

export class CreateCampaignDto {
  @ApiProperty({ example: 'Promo Hiver' })
  @IsString()
  name: string;

  @ApiProperty({ enum: CampaignType })
  @IsEnum(CampaignType)
  type: CampaignType;

  // Correction: suppression de type: 'object' pour éviter l'erreur Swagger
  @ApiProperty({
    example: '{"text": "Bonjour {{prénom}}..."}',
    description: 'JSON string or object',
  })
  @IsString()
  content: string;

  @ApiProperty({ required: false, example: 'Objet A' })
  @IsOptional()
  @IsString()
  subjectA?: string;

  @ApiProperty({ required: false, example: 'Objet B 🚀' })
  @IsOptional()
  @IsString()
  subjectB?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(90)
  abSplitPct?: number = 50;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiProperty({ example: 'Africa/Abidjan' })
  @IsOptional()
  @IsString()
  timezone?: string = 'Africa/Abidjan';

  @ApiProperty()
  @IsUUID()
  segmentId: string;
}
