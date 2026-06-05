export class CreateTemplateDto {
  accountId?: string;
  key: string;
  name: string;
  channelType?: string;
  htmlContent?: string;
  contentText?: string;
  variables?: any;
  createdBy?: string;
  isPreset?: boolean;
}
