import { AutomationsService } from './automations.service';

describe('AutomationsService (unit)', () => {
  it('schedules execution when triggerAutomationForContact is called', async () => {
    const prismaMock: any = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      automation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'a1', status: 'Active', delaySeconds: 0 }),
      },
      workflowExecution: { create: jest.fn().mockResolvedValue({ id: 'e1' }) },
    };

    const emailFactoryMock: any = { getProvider: () => ({}) };
    const smsFactoryMock: any = { getProvider: () => ({}) };
    const whatsappFactoryMock: any = { getProvider: () => ({}) };
    const contactsServiceMock: any = {};

    const queueMock: any = { add: jest.fn().mockResolvedValue(true) };

    // @ts-ignore
    const svc = new AutomationsService(
      prismaMock,
      contactsServiceMock,
      emailFactoryMock,
      smsFactoryMock,
      whatsappFactoryMock,
      queueMock,
    );

    const exec = await svc.triggerAutomationForContact('acct1', 'a1', 'c1', 0);
    expect(prismaMock.contact.findFirst).toHaveBeenCalled();
    expect(prismaMock.automation.findFirst).toHaveBeenCalled();
    expect(prismaMock.workflowExecution.create).toHaveBeenCalled();
    expect(queueMock.add).toHaveBeenCalled();
    expect(exec).toBeDefined();
  });
});
const { AutomationStatus } = require('@prisma/client');
const {
  AutomationsService,
} = require('../../dist/src/automations/automations.service');

describe('AutomationsService', () => {
  const queue = {
    add: jest.fn(),
  };

  const prisma = {
    automation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workflowExecution: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    analytic: {
      count: jest.fn(),
    },
    template: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (operations) => Promise.all(operations)),
  };

  const emailSend = jest.fn();
  const smsSend = jest.fn();

  const emailProviderFactory = {
    getProvider: jest.fn(() => ({ send: emailSend })),
  };

  const smsProviderFactory = {
    getProvider: jest.fn(() => ({ send: smsSend })),
  };

  const whatsappProviderFactory = {
    getProvider: jest.fn(() => ({
      send: jest.fn().mockResolvedValue({ success: true }),
    })),
  };

  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    emailSend.mockResolvedValue({ success: true });
    smsSend.mockResolvedValue({ success: true });
    service = new AutomationsService(
      prisma,
      {} /* contactsService mock */,
      emailProviderFactory,
      smsProviderFactory,
      // pass whatsapp factory and queue to match constructor
      whatsappProviderFactory,
      queue,
    );
  });

  it('creates an automation and writes an audit log', async () => {
    prisma.automation.create.mockResolvedValue({
      id: 'auto-1',
      accountId: 'acc-1',
      name: 'Bienvenue',
      trigger: 'contact_added',
      delaySeconds: 0,
      channel: 'Email',
      templateId: null,
      status: AutomationStatus.Draft,
      sendCount: 0,
    });

    const automation = await service.createAutomation('acc-1', {
      name: 'Bienvenue',
      trigger: 'contact_added',
      delaySeconds: 0,
      channel: 'Email',
    });

    expect(prisma.automation.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        name: 'Bienvenue',
        trigger: 'contact_added',
        triggerType: 'contact_added',
        triggerConfig: undefined,
        delaySeconds: 0,
        channel: 'Email',
        templateId: null,
        campaignId: null,
        status: AutomationStatus.Draft,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(automation.id).toBe('auto-1');
  });

  it('schedules active automations with the configured delay', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'contact-1',
      accountId: 'acc-1',
      email: 'client@example.com',
      phone: '+2250700000000',
      firstName: 'Maya',
      lastName: 'Dia',
      tags: [],
    });
    prisma.automation.findMany.mockResolvedValue([
      {
        id: 'auto-1',
        accountId: 'acc-1',
        name: 'Bienvenue',
        trigger: 'contact_added',
        delaySeconds: 1800,
        channel: 'Email',
        templateId: null,
        status: AutomationStatus.Active,
        sendCount: 0,
      },
    ]);
    prisma.workflowExecution.create.mockResolvedValue({ id: 'exec-1' });

    await service.scheduleContactAddedAutomations({
      accountId: 'acc-1',
      contactId: 'contact-1',
    });

    expect(prisma.workflowExecution.create).toHaveBeenCalledWith({
      data: {
        automationId: 'auto-1',
        contactId: 'contact-1',
        currentNodeId: null,
        status: 'Running',
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'execute-automation',
      {
        automationId: 'auto-1',
        executionId: 'exec-1',
        contactId: 'contact-1',
      },
      expect.objectContaining({
        jobId: 'exec-1',
        delay: 1800 * 1000,
        attempts: 3,
      }),
    );
  });

  it('executes the email provider for email automations', async () => {
    prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'exec-1',
      status: 'Running',
      automation: {
        id: 'auto-1',
        accountId: 'acc-1',
        name: 'Bienvenue',
        trigger: 'contact_added',
        delaySeconds: 0,
        channel: 'Email',
        templateId: null,
        status: AutomationStatus.Active,
        sendCount: 0,
        template: {
          htmlContent: '<p>Bonjour {{firstName}}</p>',
        },
      },
      contact: {
        id: 'contact-1',
        accountId: 'acc-1',
        email: 'client@example.com',
        phone: null,
        firstName: 'Maya',
        lastName: 'Dia',
        tags: [],
      },
    });
    prisma.automation.update.mockResolvedValue({ id: 'auto-1' });
    prisma.workflowExecution.update.mockResolvedValue({ id: 'exec-1' });

    await service.executeQueuedAutomation({
      automationId: 'auto-1',
      executionId: 'exec-1',
      contactId: 'contact-1',
    });

    expect(emailProviderFactory.getProvider).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledWith(
      'client@example.com',
      'Bienvenue',
      expect.stringContaining('Bonjour Maya'),
    );
    expect(prisma.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: {
        status: 'Completed',
        currentNodeId: 'completed',
        finishedAt: expect.any(Date),
      },
    });
  });

  it('processes a workflow saved by the canvas editor and resolves tag conditions', async () => {
    prisma.workflowExecution.findFirst.mockResolvedValue({
      id: 'exec-2',
      status: 'Running',
      automation: {
        id: 'auto-2',
        accountId: 'acc-1',
        name: 'Bienvenue',
        trigger: 'contact_added',
        delaySeconds: 0,
        channel: 'Email',
        templateId: null,
        status: AutomationStatus.Active,
        sendCount: 0,
        template: {
          htmlContent: '<p>Bonjour {{firstName}}</p>',
        },
        workflow: {
          startNodeId: 'n-1',
          nodes: [
            {
              id: 'n-1',
              type: 'condition',
              config: { conditionType: 'tag', tag: 'VIP' },
              nextTrue: 'n-2',
              nextFalse: 'n-3',
            },
            { id: 'n-2', type: 'action', next: 'n-4' },
            { id: 'n-3', type: 'end' },
            { id: 'n-4', type: 'end' },
          ],
          edges: [
            { from: 'n-1', to: 'n-2' },
            { from: 'n-1', to: 'n-3' },
            { from: 'n-2', to: 'n-4' },
          ],
        },
      },
      contact: {
        id: 'contact-2',
        accountId: 'acc-1',
        email: 'client@example.com',
        phone: null,
        firstName: 'Maya',
        lastName: 'Dia',
        tags: ['VIP'],
      },
    });
    prisma.automation.update.mockResolvedValue({ id: 'auto-2' });
    prisma.workflowExecution.update.mockResolvedValue({ id: 'exec-2' });

    await service.executeQueuedAutomation({
      automationId: 'auto-2',
      executionId: 'exec-2',
      contactId: 'contact-2',
    });

    expect(emailSend).toHaveBeenCalledWith(
      'client@example.com',
      'Bienvenue',
      expect.stringContaining('Bonjour Maya'),
    );
    expect(prisma.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'exec-2' },
      data: {
        status: 'Completed',
        currentNodeId: 'completed',
        finishedAt: expect.any(Date),
      },
    });
  });

  it('returns entries and exits in automation reports', async () => {
    prisma.automation.findFirst.mockResolvedValue({
      id: 'auto-report',
      accountId: 'acc-1',
      name: 'Report',
    });
    prisma.workflowExecution.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2);
    prisma.workflowExecution.findMany.mockResolvedValue([
      {
        id: 'exec-a',
        contactId: 'contact-1',
        status: 'Completed',
        startedAt: new Date('2026-05-29T10:00:00Z'),
        finishedAt: new Date('2026-05-29T10:01:00Z'),
        contact: { email: 'a@example.com' },
      },
    ]);

    const report = await service.getAutomationReport('acc-1', 'auto-report');

    expect(report).toEqual(
      expect.objectContaining({
        entries: 12,
        exits: 10,
        completed: 8,
        failed: 2,
        running: 2,
        completionRate: expect.any(Number),
      }),
    );
  });

  it('schedules a retry from action node when send fails and retry is configured', async () => {
    emailSend.mockRejectedValueOnce(new Error('provider temporary error'));
    prisma.workflowExecution.findFirst
      .mockResolvedValueOnce({
        id: 'exec-retry',
        status: 'Running',
        context: null,
        automation: {
          id: 'auto-retry',
          accountId: 'acc-1',
          name: 'Retry Flow',
          trigger: 'contact_added',
          delaySeconds: 0,
          channel: 'Email',
          templateId: null,
          campaignId: null,
          status: AutomationStatus.Active,
          sendCount: 0,
          template: { htmlContent: '<p>Hello {{firstName}}</p>' },
          workflow: {
            startNodeId: 'n-action',
            nodes: [
              {
                id: 'n-action',
                type: 'action',
                config: { retryAttempts: 3, backoffSeconds: 2 },
                next: 'n-end',
              },
              { id: 'n-end', type: 'end' },
            ],
            edges: [{ from: 'n-action', to: 'n-end' }],
          },
        },
        contact: {
          id: 'contact-retry',
          email: 'retry@example.com',
          phone: null,
          firstName: 'Retry',
          lastName: 'User',
          tags: [],
        },
      })
      .mockResolvedValueOnce({ context: null });

    prisma.workflowExecution.update.mockResolvedValue({ id: 'exec-retry' });

    const result = await service.executeQueuedAutomation({
      automationId: 'auto-retry',
      executionId: 'exec-retry',
      contactId: 'contact-retry',
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        retryScheduled: true,
        nodeId: 'n-action',
        attempt: 1,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'execute-automation',
      {
        automationId: 'auto-retry',
        executionId: 'exec-retry',
        contactId: 'contact-retry',
      },
      expect.objectContaining({
        delay: 2000,
        attempts: 3,
      }),
    );
  });

  it('applies condition open/click on automation campaign and removes tag when configured', async () => {
    prisma.workflowExecution.findFirst.mockResolvedValueOnce({
      id: 'exec-advanced',
      status: 'Running',
      context: null,
      automation: {
        id: 'auto-advanced',
        accountId: 'acc-1',
        name: 'Advanced Flow',
        trigger: 'contact_added',
        delaySeconds: 0,
        channel: 'Email',
        templateId: null,
        campaignId: 'cmp-1',
        status: AutomationStatus.Active,
        sendCount: 0,
        template: { htmlContent: '<p>Hi {{firstName}}</p>' },
        workflow: {
          startNodeId: 'n-cond',
          nodes: [
            {
              id: 'n-cond',
              type: 'condition',
              config: { conditionType: 'open' },
              nextTrue: 'n-tag-remove',
              nextFalse: 'n-end',
            },
            {
              id: 'n-tag-remove',
              type: 'tag',
              config: { tag: 'VIP', tagMode: 'remove' },
              next: 'n-end',
            },
            { id: 'n-end', type: 'end' },
          ],
          edges: [
            { from: 'n-cond', to: 'n-tag-remove', fromPort: 'right' },
            { from: 'n-cond', to: 'n-end', fromPort: 'left' },
            { from: 'n-tag-remove', to: 'n-end' },
          ],
        },
      },
      contact: {
        id: 'contact-advanced',
        email: 'advanced@example.com',
        phone: null,
        firstName: 'Advanced',
        lastName: 'User',
        tags: ['VIP', 'Lead chaud'],
      },
    });

    prisma.analytic.count.mockResolvedValue(1);
    prisma.contact.update.mockResolvedValue({ id: 'contact-advanced' });
    prisma.workflowExecution.update.mockResolvedValue({ id: 'exec-advanced' });

    await service.executeQueuedAutomation({
      automationId: 'auto-advanced',
      executionId: 'exec-advanced',
      contactId: 'contact-advanced',
    });

    expect(prisma.analytic.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: 'cmp-1',
          action: 'Open',
        }),
      }),
    );

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-advanced' },
      data: { tags: ['Lead chaud'] },
    });
  });
  afterAll(async () => {
    try {
      const queueModule = require('../../dist/src/queues/import.queue');
      if (
        queueModule.importWorker &&
        typeof queueModule.importWorker.close === 'function'
      ) {
        // close worker if initialized
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await queueModule.importWorker.close();
      }
      if (
        queueModule.importQueue &&
        typeof queueModule.importQueue.close === 'function'
      ) {
        // close queue connection
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await queueModule.importQueue.close();
      }
      if (queueModule.redisConnection) {
        const conn = queueModule.redisConnection;
        if (typeof conn.disconnect === 'function') await conn.disconnect();
        if (typeof conn.quit === 'function') await conn.quit();
      }
    } catch (e) {
      // ignore cleanup errors during tests
    }
  });
});
