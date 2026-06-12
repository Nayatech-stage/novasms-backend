import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AnalyticAction,
  AutomationStatus,
  Contact,
  Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { WhatsappProviderFactory } from '../providers/whatsapp/whatsapp.provider.factory';
import { PrismaService } from '../prisma/prisma.service';
import { renderCampaignEmailHtml } from '../campaigns/campaign-email.renderer';
import { AUTOMATION_EXECUTE_QUEUE } from './automation.execute.queue';
import type {
  AutomationWithTemplate,
  CampaignEvent,
  ContactAddedEvent,
  SegmentJoinedEvent,
  ExecuteAutomationJob,
} from './automations.types';
import type { CreateAutomationDto } from './dto/create-automation.dto';
import type { UpdateAutomationDto } from './dto/update-automation.dto';
import { ContactsService } from '../contacts/contacts.service';

type WorkflowNodeType =
  | 'trigger'
  | 'wait'
  | 'action'
  | 'end'
  | 'condition'
  | 'tag';

type WorkflowNodeConfig = {
  delaySeconds?: number;
  tag?: string;
  tagMode?: 'add' | 'remove';
  conditionType?: 'open' | 'click' | 'purchase' | 'tag' | 'field';
  campaignId?: string;
  field?: string;
  operator?: 'exists' | 'equals' | 'notEquals' | 'contains';
  value?: string;
  retryAttempts?: number;
  backoffSeconds?: number;
};

type WorkflowNode = {
  id: string;
  type: string;
  label?: string;
  config?: WorkflowNodeConfig;
  next?: string | null;
  nextTrue?: string | null;
  nextFalse?: string | null;
};

type RawWorkflowInput = {
  nodes?:
    | Array<Partial<WorkflowNode> & { id?: string }>
    | Record<string, Partial<WorkflowNode> & { id?: string }>;
  edges?: Array<{ from?: string; to?: string; fromPort?: string }>;
  startNodeId?: string | null;
};

type ExecutionWithRelations = Prisma.WorkflowExecutionGetPayload<{
  include: {
    automation: {
      include: { template: true; campaign: { include: { account: true } } };
    };
    contact: true;
  };
}>;

type NormalizedWorkflow = {
  nodes: Record<string, WorkflowNode>;
  startNodeId: string | null;
};

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactsService: ContactsService,
    private readonly emailProviderFactory: EmailProviderFactory,
    private readonly smsProviderFactory: SmsProviderFactory,
    private readonly whatsappProviderFactory: WhatsappProviderFactory,
    @InjectQueue(AUTOMATION_EXECUTE_QUEUE)
    private readonly automationQueue: Queue,
  ) {}

  async createAutomation(accountId: string, dto: CreateAutomationDto) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Le nom de l’automatisation est requis');
    }

    const templateId = dto.templateId?.trim() || null;
    if (templateId) {
      await this.assertTemplateBelongsToAccount(accountId, templateId);
    }

    const campaignId = dto.campaignId?.trim() || null;
    if (campaignId) {
      await this.assertCampaignBelongsToAccount(accountId, campaignId);
    }

    const automation = await this.prisma.automation.create({
      data: {
        accountId,
        name,
        trigger: dto.trigger,
        triggerType: dto.trigger,
        triggerConfig:
          dto.triggerConfig === undefined
            ? undefined
            : (dto.triggerConfig as Prisma.InputJsonValue),
        delaySeconds: dto.delaySeconds,
        channel: dto.channel,
        templateId,
        campaignId,
        status: this.normalizeStatus(dto.status),
      },
    });

    await this.createAuditLog(accountId, 'automation_created', {
      automationId: automation.id,
      name: automation.name,
      trigger: automation.trigger,
      channel: automation.channel,
      delaySeconds: automation.delaySeconds,
    });

    return automation;
  }

  async listAutomations(accountId: string, page = 1, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    return this.prisma.automation.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        _count: {
          select: {
            executions: true,
          },
        },
      },
    });
  }

  async getAutomation(accountId: string, id: string) {
    const automation = await this.prisma.automation.findFirst({
      where: { id, accountId },
      include: {
        template: true,
        _count: {
          select: {
            executions: true,
          },
        },
      },
    });

    if (!automation) {
      throw new BadRequestException('Automatisation introuvable');
    }

    return automation;
  }

  async updateAutomation(
    accountId: string,
    id: string,
    dto: UpdateAutomationDto,
  ) {
    const existing = await this.getAutomation(accountId, id);
    const templateId =
      dto.templateId === undefined ? undefined : dto.templateId?.trim() || null;
    const campaignId =
      dto.campaignId === undefined ? undefined : dto.campaignId?.trim() || null;

    if (templateId) {
      await this.assertTemplateBelongsToAccount(accountId, templateId);
    }

    if (campaignId) {
      await this.assertCampaignBelongsToAccount(accountId, campaignId);
    }

    return this.prisma.automation.update({
      where: { id: existing.id },
      data: {
        name: dto.name?.trim() || undefined,
        trigger: dto.trigger,
        triggerType: dto.trigger,
        triggerConfig:
          dto.triggerConfig === undefined
            ? undefined
            : (dto.triggerConfig as Prisma.InputJsonValue),
        delaySeconds: dto.delaySeconds,
        channel: dto.channel,
        templateId,
        campaignId,
        workflow:
          dto.workflow === undefined ? undefined : (dto.workflow as any),
        status: dto.status ? this.normalizeStatus(dto.status) : undefined,
      },
    });
  }

  async toggleAutomation(accountId: string, id: string) {
    const existing = await this.getAutomation(accountId, id);
    const nextStatus =
      existing.status === AutomationStatus.Active
        ? AutomationStatus.Inactive
        : AutomationStatus.Active;

    const updated = await this.prisma.automation.update({
      where: { id: existing.id },
      data: { status: nextStatus },
    });

    await this.createAuditLog(
      accountId,
      updated.status === AutomationStatus.Active
        ? 'automation_activated'
        : 'automation_deactivated',
      {
        automationId: updated.id,
        status: updated.status,
      },
    );

    return updated;
  }

  async deleteAutomation(accountId: string, id: string) {
    const existing = await this.getAutomation(accountId, id);

    if (existing.status === AutomationStatus.Active) {
      throw new ConflictException(
        'Désactivez l’automatisation avant de la supprimer',
      );
    }

    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.workflowExecution.deleteMany({
        where: { automationId: existing.id },
      });

      return tx.automation.delete({
        where: { id: existing.id },
      });
    });

    await this.createAuditLog(accountId, 'automation_deleted', {
      automationId: deleted.id,
      name: deleted.name,
    });

    return { success: true };
  }

  async scheduleContactAddedAutomations(event: ContactAddedEvent) {
    const contact =
      event.contact ??
      (await this.prisma.contact.findFirst({
        where: { id: event.contactId, accountId: event.accountId },
      }));

    if (!contact) {
      throw new BadRequestException('Contact introuvable');
    }

    await this.scheduleAutomationsForTrigger({
      accountId: event.accountId,
      trigger: 'contact_added',
      contactId: contact.id,
      // delaySeconds not passed — each automation uses its own delaySeconds
    });
  }

  async scheduleSegmentJoinedAutomations(event: SegmentJoinedEvent) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: event.contactId, accountId: event.accountId },
    });
    if (!contact) {
      throw new BadRequestException('Contact introuvable');
    }

    await this.scheduleAutomationsForTrigger({
      accountId: event.accountId,
      trigger: 'segment_joined',
      contactId: contact.id,
      segmentId: event.segmentId,
    });
  }

  async scheduleCampaignOpenedAutomations(event: CampaignEvent) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: event.contactId, accountId: event.accountId },
    });
    if (!contact) throw new BadRequestException('Contact introuvable');

    await this.scheduleAutomationsForTrigger({
      accountId: event.accountId,
      trigger: 'campaign_opened',
      contactId: contact.id,
      campaignId: event.campaignId,
    });
  }

  async scheduleCampaignClickedAutomations(event: CampaignEvent) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: event.contactId, accountId: event.accountId },
    });
    if (!contact) throw new BadRequestException('Contact introuvable');

    await this.scheduleAutomationsForTrigger({
      accountId: event.accountId,
      trigger: 'link_clicked',
      contactId: contact.id,
      campaignId: event.campaignId,
    });
  }

  // US-011: trigger inactivity_window — vérification quotidienne
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async processInactivityWindowAutomations() {
    const automations = await this.prisma.automation.findMany({
      where: { status: AutomationStatus.Active, trigger: 'inactivity_window' },
    });
    for (const automation of automations) {
      const config =
        (automation.triggerConfig as Record<string, unknown>) ?? {};
      const inactivityDays = Number(config.inactivityDays ?? 30);
      const cutoff = new Date(
        Date.now() - inactivityDays * 24 * 60 * 60 * 1000,
      );

      const inactiveContacts = await this.prisma.contact.findMany({
        where: {
          accountId: automation.accountId,
          optOut: false,
          // Contacts n'ayant pas eu d'envoi récent (proxy d'engagement)
          sends: {
            none: {
              status: 'OPENED',
              openedAt: { gte: cutoff },
            },
          },
        },
        select: { id: true },
      });

      for (const contact of inactiveContacts) {
        await this.enqueueAutomationExecution(automation, contact.id, 0);
      }
      this.logger.log(
        `Inactivity automation ${automation.id}: ${inactiveContacts.length} contacts ciblés (>${inactivityDays}j sans ouverture)`,
      );
    }
  }

  // US-011: trigger recurring_schedule — cron quotidien, config: { cronExpr, hour, minute }
  @Cron(CronExpression.EVERY_HOUR)
  async processRecurringScheduleAutomations() {
    const automations = await this.prisma.automation.findMany({
      where: { status: AutomationStatus.Active, trigger: 'recurring_schedule' },
    });
    const now = new Date();
    for (const automation of automations) {
      const config =
        (automation.triggerConfig as Record<string, unknown>) ?? {};
      const targetHour = Number(config.hour ?? 9);
      const targetMinute = Number(config.minute ?? 0);
      if (
        now.getUTCHours() !== targetHour ||
        Math.abs(now.getUTCMinutes() - targetMinute) > 30
      )
        continue;

      const lastFiredAt = config.lastFiredAt
        ? new Date(config.lastFiredAt as string)
        : null;
      if (
        lastFiredAt &&
        now.getTime() - lastFiredAt.getTime() < 23 * 60 * 60 * 1000
      )
        continue; // déjà lancé aujourd'hui

      const contacts = await this.prisma.contact.findMany({
        where: { accountId: automation.accountId, optOut: false },
        select: { id: true },
      });
      for (const contact of contacts) {
        await this.enqueueAutomationExecution(automation, contact.id, 0);
      }
      await this.prisma.automation.update({
        where: { id: automation.id },
        data: {
          triggerConfig: {
            ...(config as object),
            lastFiredAt: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      this.logger.log(
        `Recurring automation ${automation.id} fired for ${contacts.length} contacts`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueDateBasedAutomations() {
    const automations = await this.prisma.automation.findMany({
      where: {
        status: AutomationStatus.Active,
        trigger: 'date_based',
      },
    });

    const now = Date.now();
    for (const automation of automations) {
      const triggerConfig =
        (automation.triggerConfig as Record<string, unknown> | null) ?? {};
      const firedAt = triggerConfig?.firedAt;
      const runAtValue =
        triggerConfig?.runAt ??
        triggerConfig?.date ??
        triggerConfig?.scheduledAt;

      if (firedAt) continue;
      if (typeof runAtValue !== 'string' && !(runAtValue instanceof Date))
        continue;

      const runAt = new Date(runAtValue as string | Date);
      if (Number.isNaN(runAt.getTime()) || runAt.getTime() > now) continue;

      const targetContacts = await this.resolveDateBasedTargets(automation);
      if (targetContacts.length === 0) {
        this.logger.warn(
          `Date-based automation ${automation.id} is due but has no target contacts`,
        );
        continue;
      }

      for (const contact of targetContacts) {
        await this.enqueueAutomationExecution(automation, contact.id, 0);
      }

      await this.prisma.automation.update({
        where: { id: automation.id },
        data: {
          triggerConfig: {
            ...(triggerConfig || {}),
            firedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `Date-based automation ${automation.id} fired for ${targetContacts.length} contact(s)`,
      );
    }
  }

  async triggerAutomationForContact(
    accountId: string,
    automationId: string,
    contactId: string,
    delaySeconds?: number,
  ) {
    // verify contact belongs to account
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, accountId },
    });
    if (!contact) throw new BadRequestException('Contact introuvable');

    const automation = await this.prisma.automation.findFirst({
      where: { id: automationId, accountId },
    });
    if (!automation)
      throw new BadRequestException('Automatisation introuvable');

    if (automation.status !== AutomationStatus.Active) {
      throw new BadRequestException('Automatisation inactive');
    }

    const execution = await this.prisma.workflowExecution.create({
      data: {
        automationId: automation.id,
        contactId: contact.id,
        currentNodeId: null,
        status: 'Running',
      },
    });

    const jobData: ExecuteAutomationJob = {
      automationId: automation.id,
      executionId: execution.id,
      contactId: contact.id,
    };

    await this.automationQueue.add('execute-automation', jobData, {
      jobId: execution.id,
      delay:
        Math.max(
          0,
          typeof delaySeconds === 'number'
            ? delaySeconds
            : (automation.delaySeconds ?? 0),
        ) * 1000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });

    return execution;
  }

  private async scheduleAutomationsForTrigger(params: {
    accountId: string;
    trigger:
      | 'contact_added'
      | 'segment_joined'
      | 'campaign_opened'
      | 'link_clicked';
    contactId: string;
    campaignId?: string;
    segmentId?: string;
    delaySeconds?: number;
  }) {
    const automations = await this.prisma.automation.findMany({
      where: {
        accountId: params.accountId,
        trigger: params.trigger,
        status: AutomationStatus.Active,
      },
    });

    for (const automation of automations) {
      const automationCampaignId =
        automation.campaignId ||
        (automation.triggerConfig as any)?.campaignId ||
        null;
      const automationSegmentId =
        (automation.triggerConfig as any)?.segmentId || null;
      if (
        params.campaignId &&
        automationCampaignId &&
        automationCampaignId !== params.campaignId
      ) {
        continue;
      }

      if (
        params.segmentId &&
        automationSegmentId &&
        automationSegmentId !== params.segmentId
      ) {
        continue;
      }

      await this.enqueueAutomationExecution(
        automation,
        params.contactId,
        typeof params.delaySeconds === 'number'
          ? params.delaySeconds
          : (automation.delaySeconds ?? 0),
      );

      this.logger.log(
        `Scheduled automation ${automation.id} for trigger ${params.trigger} and contact ${params.contactId}`,
      );
    }
  }

  private async enqueueAutomationExecution(
    automation: { id: string; delaySeconds: number | null },
    contactId: string,
    delaySeconds: number,
  ) {
    const execution = await this.prisma.workflowExecution.create({
      data: {
        automationId: automation.id,
        contactId,
        currentNodeId: null,
        status: 'Running',
      },
    });

    const jobData: ExecuteAutomationJob = {
      automationId: automation.id,
      executionId: execution.id,
      contactId,
    };

    await this.automationQueue.add('execute-automation', jobData, {
      jobId: execution.id,
      delay: Math.max(0, delaySeconds) * 1000,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
    });
  }

  private async resolveDateBasedTargets(automation: {
    accountId: string;
    campaignId: string | null;
    triggerConfig: Prisma.JsonValue | null;
  }) {
    const triggerConfig =
      (automation.triggerConfig as Record<string, unknown> | null) ?? {};
    const explicitContactId =
      typeof triggerConfig.contactId === 'string'
        ? triggerConfig.contactId
        : null;
    const explicitSegmentId =
      typeof triggerConfig.segmentId === 'string'
        ? triggerConfig.segmentId
        : null;

    if (explicitContactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: explicitContactId, accountId: automation.accountId },
      });
      return contact ? [contact] : [];
    }

    const segmentId =
      explicitSegmentId ||
      (await this.resolveCampaignSegmentId(automation.campaignId));
    if (!segmentId) return [];

    const segment = await this.prisma.segment.findFirst({
      where: { id: segmentId, accountId: automation.accountId },
    });
    if (!segment) return [];

    const parsed = this.contactsService.normalizeSegmentCriteria(
      segment.criteria,
    );
    const where = this.contactsService.buildWhereForSegment(
      automation.accountId,
      parsed.logic,
      parsed.rules,
    );

    return this.prisma.contact.findMany({
      where,
      select: { id: true },
    });
  }

  private async resolveCampaignSegmentId(campaignId: string | null) {
    if (!campaignId) return null;
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId },
      select: { segmentId: true },
    });
    return campaign?.segmentId ?? null;
  }

  async getAutomationReport(accountId: string, automationId: string) {
    const automation = await this.prisma.automation.findFirst({
      where: { id: automationId, accountId },
    });
    if (!automation)
      throw new BadRequestException('Automatisation introuvable');

    const total = await this.prisma.workflowExecution.count({
      where: { automationId },
    });
    const completed = await this.prisma.workflowExecution.count({
      where: { automationId, status: 'Completed' },
    });
    const failed = await this.prisma.workflowExecution.count({
      where: { automationId, status: 'Failed' },
    });
    const running = await this.prisma.workflowExecution.count({
      where: { automationId, status: 'Running' },
    });

    const samples = await this.prisma.workflowExecution.findMany({
      where: { automationId },
      take: 10,
      orderBy: { startedAt: 'desc' },
      include: { contact: true },
    });

    const completionRate = total > 0 ? (completed / total) * 100 : 0;
    const exits = completed + failed;

    return {
      automationId,
      name: automation.name,
      entries: total,
      exits,
      total,
      completed,
      failed,
      running,
      completionRate,
      recent: samples.map((s) => ({
        id: s.id,
        contactId: s.contactId,
        contactEmail: s.contact?.email,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
    };
  }

  async executeQueuedAutomation(jobData: ExecuteAutomationJob) {
    const execution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: jobData.executionId,
        automationId: jobData.automationId,
        contactId: jobData.contactId,
      },
      include: {
        automation: {
          include: {
            template: true,
            // include campaign with account so renderers can use companyName
            campaign: { include: { account: true } },
          },
        },
        contact: true,
      },
    });

    if (!execution) {
      throw new BadRequestException('Exécution introuvable');
    }

    if (execution.status !== 'Running') {
      return { success: true, skipped: true };
    }

    // If automation contains a workflow definition, process it via the workflow engine.
    const workflow = execution.automation.workflow;
    if (workflow && typeof workflow === 'object') {
      return this.processWorkflowExecution(
        execution,
        workflow as RawWorkflowInput,
        execution.contact,
      );
    }

    // fallback: simple send (legacy behaviour)
    await this.sendAutomationMessage(execution.automation, execution.contact);
    await this.deductAutomationCredit(
      execution.automation.accountId,
      execution.automation.channel,
    );

    await this.prisma.$transaction([
      this.prisma.automation.update({
        where: { id: execution.automation.id },
        data: {
          sendCount: {
            increment: 1,
          },
        },
      }),
      this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: 'Completed',
          currentNodeId: 'completed',
          finishedAt: new Date(),
        },
      }),
    ]);

    return { success: true };
  }

  private async processWorkflowExecution(
    execution: ExecutionWithRelations,
    workflow: RawWorkflowInput,
    contact: Contact,
  ) {
    const normalized = this.normalizeWorkflow(workflow);
    const nodes = normalized.nodes;
    let currentNodeId = execution.currentNodeId || normalized.startNodeId;
    this.logger.debug(
      `Processing workflow execution ${execution.id} starting at node ${currentNodeId}`,
    );
    while (currentNodeId) {
      const node = nodes[currentNodeId];
      if (!node) break;
      const nodeType = this.normalizeNodeType(node.type);

      // US-012: persistance du nœud en cours avant exécution (resume resilience)
      await this.prisma.workflowExecution
        .update({
          where: { id: execution.id },
          data: { currentNodeId, status: 'Running' },
        })
        .catch(() => {
          /* non-bloquant */
        });

      this.logger.debug(
        `Execution ${execution.id}: entering node ${node.id} type=${nodeType}`,
      );
      switch (nodeType) {
        case 'action':
          try {
            await this.sendAutomationMessage(execution.automation, contact);
            await this.deductAutomationCredit(
              execution.automation.accountId,
              execution.automation.channel,
            );
            await this.prisma.automation.update({
              where: { id: execution.automation.id },
              data: { sendCount: { increment: 1 } },
            });
            await this.updateExecutionNodeAttempt(execution.id, node.id, null);
            this.logger.debug(
              `Execution ${execution.id}: action node ${node.id} succeeded; moving to ${node.next || 'none'}`,
            );
            currentNodeId = node.next || null;
          } catch (error) {
            const retryAttempts = this.normalizeRetryAttempts(
              node.config?.retryAttempts,
            );
            const backoffSeconds = this.normalizeBackoffSeconds(
              node.config?.backoffSeconds,
            );
            const currentAttempt = await this.getExecutionNodeAttempt(
              execution.id,
              node.id,
            );
            const nextAttempt = currentAttempt + 1;

            if (nextAttempt < retryAttempts) {
              await this.updateExecutionNodeAttempt(
                execution.id,
                node.id,
                nextAttempt,
              );
              await this.prisma.workflowExecution.update({
                where: { id: execution.id },
                data: { currentNodeId: node.id, status: 'Running' },
              });

              const jobData: ExecuteAutomationJob = {
                automationId: execution.automation.id,
                executionId: execution.id,
                contactId: contact.id,
              };

              await this.automationQueue.add('execute-automation', jobData, {
                jobId: execution.id,
                delay: Math.max(0, backoffSeconds * nextAttempt) * 1000,
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
                removeOnComplete: true,
              });

              this.logger.warn(
                `Execution ${execution.id}: scheduling retry ${nextAttempt} for node ${node.id} after ${backoffSeconds * nextAttempt}s`,
              );

              return {
                success: true,
                retryScheduled: true,
                nodeId: node.id,
                attempt: nextAttempt,
              };
            }

            throw error;
          }
          break;

        case 'tag':
          try {
            const tag = this.getWorkflowTag(node);
            if (tag) {
              const existing: string[] = Array.isArray(contact.tags)
                ? contact.tags.filter(
                    (entry): entry is string => typeof entry === 'string',
                  )
                : [];
              const tagMode = this.getWorkflowTagMode(node);
              const nextTags =
                tagMode === 'remove'
                  ? existing.filter((entry) => entry !== tag)
                  : Array.from(new Set([...existing, tag]));
              await this.prisma.contact.update({
                where: { id: contact.id },
                data: { tags: nextTags },
              });
              contact.tags = nextTags;
            }
          } catch (e) {
            this.logger.warn(`Failed to apply tag node: ${e}`);
          }
          currentNodeId = node.next || null;
          break;

        case 'condition': {
          const conditionResult = await this.evaluateWorkflowCondition(
            execution,
            node,
            contact,
          );

          currentNodeId = conditionResult
            ? node.nextTrue || node.next || null
            : node.nextFalse || null;
          break;
        }

        case 'wait': {
          // schedule continuation after delaySeconds
          const delaySeconds = Number(node.config?.delaySeconds ?? 0) || 0;
          const nextNode = node.next || null;

          // persist progress and re-enqueue job
          await this.prisma.workflowExecution.update({
            where: { id: execution.id },
            data: { currentNodeId: nextNode, status: 'Running' },
          });

          const jobData: ExecuteAutomationJob = {
            automationId: execution.automation.id,
            executionId: execution.id,
            contactId: contact.id,
          };

          await this.automationQueue.add('execute-automation', jobData, {
            jobId: execution.id,
            delay: Math.max(0, delaySeconds) * 1000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
          });

          this.logger.log(
            `Execution ${execution.id}: delayed continuation scheduled for ${delaySeconds}s, next node ${nextNode}`,
          );

          return { success: true, delayed: true };
        }

        case 'end':
          // mark completed
          await this.prisma.workflowExecution.update({
            where: { id: execution.id },
            data: {
              status: 'Completed',
              currentNodeId: 'completed',
              finishedAt: new Date(),
            },
          });
          return { success: true };

        default:
          // unknown node type: stop
          this.logger.warn(`Unknown workflow node type: ${node.type}`);
          currentNodeId = node.next || null;
          break;
      }
    }

    this.logger.log(
      `Execution ${execution.id}: workflow completed, marking finished`,
    );

    // If we exit the loop with no more nodes, mark execution completed
    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: 'Completed',
        currentNodeId: 'completed',
        finishedAt: new Date(),
      },
    });
    return { success: true };
  }

  async markExecutionFailed(executionId: string, reason: string) {
    this.logger.error(`Automation execution ${executionId} failed: ${reason}`);

    return this.prisma.workflowExecution.updateMany({
      where: {
        id: executionId,
        status: 'Running',
      },
      data: {
        status: 'Failed',
        finishedAt: new Date(),
      },
    });
  }

  async createAuditLog(
    accountId: string,
    action: string,
    details?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
  ) {
    return this.prisma.auditLog.create({
      data: { accountId, action, details: details as any },
    });
  }

  private normalizeNodeType(type: string): WorkflowNodeType | 'unknown' {
    const normalized = String(type || '')
      .trim()
      .toLowerCase();
    if (
      normalized === 'action' ||
      normalized === 'wait' ||
      normalized === 'condition' ||
      normalized === 'tag' ||
      normalized === 'end' ||
      normalized === 'trigger'
    ) {
      return normalized;
    }
    return 'unknown';
  }

  private normalizeWorkflow(
    workflow: RawWorkflowInput | null | undefined,
  ): NormalizedWorkflow {
    const rawNodes = Array.isArray(workflow?.nodes)
      ? workflow.nodes
      : workflow?.nodes && typeof workflow.nodes === 'object'
        ? Object.values(workflow.nodes)
        : [];

    const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
    const nodes: Record<string, WorkflowNode> = {};

    for (const rawNode of rawNodes as Array<
      Partial<WorkflowNode> & { id?: string }
    >) {
      if (!rawNode?.id) continue;
      nodes[rawNode.id] = {
        id: rawNode.id,
        type: String(rawNode.type || 'action'),
        label: rawNode.label,
        config: rawNode.config,
        next: rawNode.next ?? null,
        nextTrue: rawNode.nextTrue ?? null,
        nextFalse: rawNode.nextFalse ?? null,
      };
    }

    const outgoing = new Map<
      string,
      Array<{ to: string; fromPort?: string }>
    >();
    for (const edge of edges as Array<{
      from?: string;
      to?: string;
      fromPort?: string;
    }>) {
      if (!edge?.from || !edge?.to) continue;
      const list = outgoing.get(edge.from) || [];
      list.push({ to: edge.to, fromPort: edge.fromPort });
      outgoing.set(edge.from, list);
    }

    for (const node of Object.values(nodes)) {
      const nextNodes = outgoing.get(node.id) || [];
      if (this.normalizeNodeType(node.type) === 'condition') {
        const right = nextNodes.find((edge) => edge.fromPort === 'right');
        const left = nextNodes.find((edge) => edge.fromPort === 'left');
        node.nextTrue = node.nextTrue || right?.to || nextNodes[0]?.to || null;
        node.nextFalse = node.nextFalse || left?.to || nextNodes[1]?.to || null;
      } else if (!node.next) {
        node.next = nextNodes[0]?.to || null;
      }
    }

    const startNodeId =
      workflow?.startNodeId ||
      Object.values(nodes).find(
        (node) => this.normalizeNodeType(node.type) === 'trigger',
      )?.id ||
      rawNodes[0]?.id ||
      Object.keys(nodes)[0] ||
      null;

    return { nodes, startNodeId };
  }

  private getWorkflowTag(node: WorkflowNode): string | null {
    const tag = node.config?.tag || node.config?.value;
    return typeof tag === 'string' && tag.trim() ? tag.trim() : null;
  }

  private getWorkflowTagMode(node: WorkflowNode): 'add' | 'remove' {
    return node.config?.tagMode === 'remove' ? 'remove' : 'add';
  }

  private async evaluateWorkflowCondition(
    execution: { automation?: { campaignId?: string | null } },
    node: WorkflowNode,
    contact: Contact,
  ): Promise<boolean> {
    const config = node.config || {};
    const conditionType = config.conditionType || 'field';

    if (conditionType === 'tag') {
      const tag = this.getWorkflowTag(node);
      const tags = Array.isArray(contact.tags) ? contact.tags : [];
      return Boolean(tag && tags.includes(tag));
    }

    if (conditionType === 'purchase') {
      const lastPurchaseDate = (contact as Record<string, unknown>)
        .lastPurchaseDate;
      if (!lastPurchaseDate) return false;
      const parsed = new Date(lastPurchaseDate as string);
      return !Number.isNaN(parsed.getTime());
    }

    if (conditionType === 'open' || conditionType === 'click') {
      const action = conditionType === 'open' ? 'Open' : 'Click';
      const campaignId =
        config.campaignId || execution.automation?.campaignId || null;
      const count = await this.prisma.analytic.count({
        where: {
          contactId: contact.id,
          ...(campaignId ? { campaignId } : {}),
          action: action as AnalyticAction,
        },
      });
      return count > 0;
    }

    const field = config.field;
    const operator = config.operator || 'exists';
    const value = config.value;

    if (!field) return false;

    const fieldValue = (contact as Record<string, unknown>)[field];

    switch (operator) {
      case 'exists':
        return Boolean(fieldValue);
      case 'equals':
        return String(fieldValue ?? '') === String(value ?? '');
      case 'notEquals':
        return String(fieldValue ?? '') !== String(value ?? '');
      case 'contains':
        return String(fieldValue ?? '')
          .toLowerCase()
          .includes(String(value ?? '').toLowerCase());
      default:
        return false;
    }
  }

  private normalizeRetryAttempts(value?: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(5, Math.max(1, Math.round(parsed)));
  }

  private normalizeBackoffSeconds(value?: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(86400, Math.max(0, Math.round(parsed)));
  }

  private async getExecutionNodeAttempt(
    executionId: string,
    nodeId: string,
  ): Promise<number> {
    const record = await this.prisma.workflowExecution.findFirst({
      where: { id: executionId },
      select: { context: true },
    });
    const context = this.parseExecutionContext(record?.context);
    return Number(context.nodeAttempts[nodeId] ?? 0) || 0;
  }

  private async updateExecutionNodeAttempt(
    executionId: string,
    nodeId: string,
    attempt: number | null,
  ) {
    const record = await this.prisma.workflowExecution.findFirst({
      where: { id: executionId },
      select: { context: true },
    });
    const context = this.parseExecutionContext(record?.context);

    if (attempt === null || attempt <= 0) {
      delete context.nodeAttempts[nodeId];
    } else {
      context.nodeAttempts[nodeId] = attempt;
    }

    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        context: context,
      },
    });
  }

  private parseExecutionContext(value: unknown): {
    nodeAttempts: Record<string, number>;
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { nodeAttempts: {} };
    }

    const rawNodeAttempts = (value as Record<string, unknown>).nodeAttempts;
    if (
      !rawNodeAttempts ||
      typeof rawNodeAttempts !== 'object' ||
      Array.isArray(rawNodeAttempts)
    ) {
      return { nodeAttempts: {} };
    }

    const nodeAttempts: Record<string, number> = {};
    for (const [key, attempt] of Object.entries(
      rawNodeAttempts as Record<string, unknown>,
    )) {
      const parsed = Number(attempt);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      nodeAttempts[key] = Math.round(parsed);
    }

    return { nodeAttempts };
  }

  private normalizeStatus(status?: 'Active' | 'Inactive' | 'Draft') {
    return status ? AutomationStatus[status] : AutomationStatus.Draft;
  }

  private async assertTemplateBelongsToAccount(
    accountId: string,
    templateId: string,
  ) {
    const template = await this.prisma.template.findFirst({
      where: {
        id: templateId,
        accountId,
      },
    });

    if (!template) {
      throw new BadRequestException('Template introuvable pour ce compte');
    }
  }

  private async assertCampaignBelongsToAccount(
    accountId: string,
    campaignId: string,
  ) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: campaignId,
        accountId,
      },
      select: { id: true },
    });

    if (!campaign) {
      throw new BadRequestException('Campagne introuvable pour ce compte');
    }
  }

  private async sendAutomationMessage(
    automation: AutomationWithTemplate,
    contact: {
      id: string;
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
      tags: Prisma.JsonValue | null;
    },
  ) {
    const campaign = automation.campaign;
    const templateContent = automation.template?.htmlContent?.trim();
    const campaignSubject = campaign?.subject?.trim() || automation.name;
    const fallbackContent = this.buildFallbackContent(automation, contact);

    let personalizedHtml: string;
    if (templateContent) {
      personalizedHtml = this.applyContactTokens(templateContent, contact);
    } else if (campaign && automation.channel === 'Email') {
      personalizedHtml = renderCampaignEmailHtml(
        campaign.contentJson,
        campaign.content?.trim() || fallbackContent,
        {
          firstName: contact.firstName ?? undefined,
          lastName: contact.lastName ?? undefined,
          fullName:
            [contact.firstName, contact.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() || undefined,
          email: contact.email ?? undefined,
          phone: contact.phone ?? undefined,
          companyName: (campaign as any)?.account?.companyName || undefined,
          promoCode: (campaign as any)?.promoCode || undefined,
        },
      );
    } else if (campaign) {
      personalizedHtml = this.applyContactTokens(
        campaign.content?.trim() || fallbackContent,
        contact,
      );
    } else {
      personalizedHtml = this.applyContactTokens(fallbackContent, contact);
    }

    const subject = campaign ? campaignSubject : automation.name;

    if (automation.channel === 'WhatsApp') {
      const phone = contact.phone;
      if (!phone)
        throw new BadRequestException(
          'Le contact ne possède pas de numéro de téléphone pour WhatsApp',
        );
      const message = this.stripHtml(personalizedHtml);
      const result = await this.whatsappProviderFactory
        .getProvider()
        .send(phone, message);
      if (!result.success)
        throw new Error(result.error || 'Envoi WhatsApp impossible');
      return;
    }

    if (automation.channel === 'Email') {
      const email = contact.email;
      if (!email) {
        throw new BadRequestException(
          'Le contact ne possède pas d’adresse email',
        );
      }

      const result = await this.emailProviderFactory
        .getProvider()
        .send(email, subject, personalizedHtml);

      if (!result.success) {
        throw new Error(result.error || 'Envoi email impossible');
      }

      return;
    }

    const phone = contact.phone;
    if (!phone) {
      throw new BadRequestException(
        'Le contact ne possède pas de numéro de téléphone',
      );
    }

    const message = this.stripHtml(personalizedHtml);
    const result = await this.smsProviderFactory
      .getProvider()
      .send(phone, message);

    if (!result.success) {
      throw new Error(result.error || 'Envoi SMS impossible');
    }
  }

  private buildFallbackContent(
    automation: AutomationWithTemplate,
    contact: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    },
  ) {
    const fullName = [contact.firstName, contact.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const recipient = fullName || contact.email || 'votre contact';

    return `<div><p>Bonjour ${recipient},</p><p>${automation.name}</p></div>`;
  }

  private applyContactTokens(
    content: string,
    contact: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
    },
  ) {
    const replacements: Array<[RegExp, string]> = [
      [/\{\{\s*firstName\s*\}\}/gi, contact.firstName ?? ''],
      [/\{\{\s*lastName\s*\}\}/gi, contact.lastName ?? ''],
      [/\{\{\s*email\s*\}\}/gi, contact.email ?? ''],
      [/\{\{\s*phone\s*\}\}/gi, contact.phone ?? ''],
    ];

    return replacements.reduce(
      (accumulator, [pattern, replacement]) =>
        accumulator.replace(pattern, replacement),
      content,
    );
  }

  private stripHtml(content: string) {
    return content
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Déduit le coût d'un envoi automation du solde du compte.
   * Défauts : SMS=5 FCFA, Email=1 FCFA, WhatsApp=10 FCFA.
   * Atomique — empêche le solde négatif.
   */
  private async deductAutomationCredit(
    accountId: string,
    channel: string,
  ): Promise<void> {
    const defaultCosts: Record<string, number> = {
      SMS: 5,
      Email: 1,
      WhatsApp: 10,
    };
    const envKey =
      channel === 'SMS'
        ? 'CREDIT_COST_PER_SMS'
        : channel === 'Email'
          ? 'CREDIT_COST_PER_EMAIL'
          : channel === 'WhatsApp'
            ? 'CREDIT_COST_PER_WHATSAPP'
            : null;

    const cost = envKey
      ? parseFloat(process.env[envKey] || String(defaultCosts[channel] ?? 0))
      : (defaultCosts[channel] ?? 0);

    if (cost <= 0) return;

    const result = await this.prisma.$executeRaw`
      UPDATE accounts
      SET    credit_balance = credit_balance - ${cost}::decimal
      WHERE  id = ${accountId}::uuid
      AND    credit_balance >= ${cost}::decimal
    `;

    if (result === 0) {
      this.logger.warn(
        `Account ${accountId}: solde insuffisant pour déduire ${cost} FCFA (automation ${channel}).`,
      );
    }
  }
}
