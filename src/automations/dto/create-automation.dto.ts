import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAutomationDto {
  @IsString()
  @MinLength(2)
  name!: string;

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
  trigger!:
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

  @IsInt()
  @Min(0)
  delaySeconds!: number;

  @IsString()
  @IsIn(['Email', 'SMS', 'WhatsApp'])
  channel!: 'Email' | 'SMS' | 'WhatsApp';

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['Active', 'Inactive', 'Draft'])
  status?: 'Active' | 'Inactive' | 'Draft';
}
