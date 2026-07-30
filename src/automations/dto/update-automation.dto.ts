import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
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
    'birthday',
    'inactivity_window',
    'recurring_schedule',
  ])
  trigger?:
    | 'contact_added'
    | 'api'
    | 'segment_joined'
    | 'tag_added'
    | 'campaign_opened'
    | 'link_clicked'
    | 'date_based'
    | 'birthday'
    | 'inactivity_window'
    | 'recurring_schedule';

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
  @ValidateIf((o) => o.templateId !== null)
  @IsString()
  templateId?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.campaignId !== null)
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
