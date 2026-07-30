import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  IsObject,
} from 'class-validator';

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'contact_added',
    'api',
    'segment_joined',
    'tag_added',
    'campaign_opened',
    'link_clicked',
    'date_based',
  ])
  trigger?:
    | 'contact_added'
    | 'api'
    | 'segment_joined'
    | 'tag_added'
    | 'campaign_opened'
    | 'link_clicked'
    | 'date_based';

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  delaySeconds?: number;

  @IsOptional()
  @IsString()
  @IsIn(['Email', 'SMS', 'WhatsApp'])
  channel?: 'Email' | 'SMS' | 'WhatsApp';

  @IsOptional()
  @IsString()
  templateId?: string | null;

  @IsOptional()
  @IsString()
  campaignId?: string | null;

  @IsOptional()
  @IsObject()
  workflow?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  @IsIn(['Active', 'Inactive', 'Draft'])
  status?: 'Active' | 'Inactive' | 'Draft';
}
