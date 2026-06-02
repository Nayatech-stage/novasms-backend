import type { Contact, Automation, Campaign, Template } from '@prisma/client';

export type ContactAddedEvent = {
  accountId: string;
  contactId: string;
  contact?: Pick<
    Contact,
    'id' | 'accountId' | 'email' | 'phone' | 'firstName' | 'lastName' | 'tags'
  >;
};

export type SegmentJoinedEvent = {
  accountId: string;
  contactId: string;
  segmentId: string;
};

export type CampaignEvent = {
  accountId: string;
  campaignId: string;
  contactId: string;
};

export type ExecuteAutomationJob = {
  automationId: string;
  executionId: string;
  contactId: string;
};

export type AutomationWithTemplate = Automation & {
  template: Template | null;
  campaign: Campaign | null;
};
