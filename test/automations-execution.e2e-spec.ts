import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BullRegistrar, getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailProviderFactory } from '../src/providers/email/email.provider.factory';
import { SmsProviderFactory } from '../src/providers/sms/sms.provider.factory';
import { WhatsappProviderFactory } from '../src/providers/whatsapp/whatsapp.provider.factory';
import { AUTOMATION_EXECUTE_QUEUE } from '../src/automations/automation.execute.queue';
import { AutomationsService } from '../src/automations/automations.service';

describe('Automations Execution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let automationsService: AutomationsService;
  let authToken = '';
  let accountId = '';
  let contactId = '';
  let automationId = '';

  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const emailSend = jest.fn().mockResolvedValue({ success: true });

  beforeEach(() => {
    queueAdd.mockClear();
    emailSend.mockClear();
  });

  beforeAll(async () => {
    const queueMock = {
      add: queueAdd,
      close: jest.fn().mockResolvedValue(undefined),
    };

    const emailFactoryMock = {
      getProvider: () => ({ send: emailSend }),
    };

    const smsFactoryMock = {
      getProvider: () => ({
        send: jest.fn().mockResolvedValue({ success: true }),
      }),
    };

    const whatsappFactoryMock = {
      getProvider: () => ({
        send: jest.fn().mockResolvedValue({ success: true }),
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BullRegistrar)
      .useValue({
        register: jest.fn(),
        onModuleInit: jest.fn(),
      })
      .overrideProvider(getQueueToken(AUTOMATION_EXECUTE_QUEUE))
      .useValue(queueMock)
      .overrideProvider('BullQueue_default')
      .useValue(queueMock)
      .overrideProvider(EmailProviderFactory)
      .useValue(emailFactoryMock)
      .overrideProvider(SmsProviderFactory)
      .useValue(smsFactoryMock)
      .overrideProvider(WhatsappProviderFactory)
      .useValue(whatsappFactoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    automationsService =
      moduleFixture.get<AutomationsService>(AutomationsService);

    const runId = Date.now();
    const email = `automation-e2e-${runId}@novasms.test`;
    const password = 'NovaSms@123';

    await request(app.getHttpServer()).post('/auth/register').send({
      nom: 'Automation E2E Company',
      email,
      motDePasse: password,
      nomBoutique: 'Automation E2E Boutique',
      pays: 'CIV',
    });

    await prisma.account.update({
      where: { adminEmail: email },
      data: { emailVerified: true },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, motDePasse: password })
      .expect(200);

    authToken = loginResponse.body.accessToken as string;

    const account = await prisma.account.findFirst({
      where: { adminEmail: email },
    });
    if (!account) {
      throw new Error('Account not found after registration');
    }

    accountId = account.id;
  });

  afterAll(async () => {
    if (accountId) {
      await prisma.analytic.deleteMany({
        where: {
          OR: [{ contact: { accountId } }, { campaign: { accountId } }],
        },
      });
      await prisma.workflowExecution.deleteMany({
        where: { automation: { accountId } },
      });
      await prisma.automation.deleteMany({ where: { accountId } });
      await prisma.campaign.deleteMany({ where: { accountId } });
      await prisma.contact.deleteMany({ where: { accountId } });
      await prisma.account.delete({ where: { id: accountId } });
    }

    await app.close();
  });

  it('triggers an automation, enqueues job, and completes execution', async () => {
    const contactResponse = await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Maya',
        lastName: 'E2E',
        email: `contact-${Date.now()}@novasms.test`,
      })
      .expect(201);

    contactId = contactResponse.body.id as string;

    const createAutomationResponse = await request(app.getHttpServer())
      .post('/automations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Automation Trigger E2E',
        trigger: 'api',
        delaySeconds: 0,
        channel: 'Email',
        status: 'Active',
      })
      .expect(201);

    automationId = createAutomationResponse.body.id as string;

    const triggerResponse = await request(app.getHttpServer())
      .post(`/automations/${automationId}/trigger`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contactId })
      .expect(201);

    const executionId = triggerResponse.body.id as string;
    expect(executionId).toBeTruthy();

    expect(queueAdd).toHaveBeenCalledWith(
      'execute-automation',
      {
        automationId,
        executionId,
        contactId,
      },
      expect.objectContaining({
        jobId: executionId,
        delay: 0,
      }),
    );

    const runningExecution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    expect(runningExecution?.status).toBe('Running');

    await automationsService.executeQueuedAutomation({
      automationId,
      executionId,
      contactId,
    });

    const completedExecution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(completedExecution?.status).toBe('Completed');
    expect(completedExecution?.finishedAt).toBeTruthy();
  });

  it('routes condition node by campaign open event', async () => {
    const contactWithOpenResponse = await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Open',
        lastName: 'Contact',
        email: `open-${Date.now()}@novasms.test`,
      })
      .expect(201);

    const contactWithoutOpenResponse = await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'NoOpen',
        lastName: 'Contact',
        email: `no-open-${Date.now()}@novasms.test`,
      })
      .expect(201);

    const contactWithOpenId = contactWithOpenResponse.body.id as string;
    const contactWithoutOpenId = contactWithoutOpenResponse.body.id as string;

    const campaign = await prisma.campaign.create({
      data: {
        accountId,
        channelType: 'EMAIL',
        name: 'Condition Campaign E2E',
      },
    });

    await prisma.analytic.create({
      data: {
        campaignId: campaign.id,
        contactId: contactWithOpenId,
        action: 'Open',
        createdAt: new Date(),
      },
    });

    const createAutomationResponse = await request(app.getHttpServer())
      .post('/automations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Condition Open Routing E2E',
        trigger: 'api',
        delaySeconds: 0,
        channel: 'Email',
        status: 'Active',
        campaignId: campaign.id,
      })
      .expect(201);

    const conditionAutomationId = createAutomationResponse.body.id as string;

    await request(app.getHttpServer())
      .patch(`/automations/${conditionAutomationId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        workflow: {
          startNodeId: 'trigger_1',
          nodes: [
            { id: 'trigger_1', type: 'trigger' },
            {
              id: 'condition_open',
              type: 'condition',
              config: { conditionType: 'open', campaignId: campaign.id },
            },
            {
              id: 'tag_engaged',
              type: 'tag',
              config: { tag: 'engaged', tagMode: 'add' },
            },
            {
              id: 'tag_cold',
              type: 'tag',
              config: { tag: 'cold', tagMode: 'add' },
            },
            { id: 'end_true', type: 'end' },
            { id: 'end_false', type: 'end' },
          ],
          edges: [
            { from: 'trigger_1', to: 'condition_open' },
            { from: 'condition_open', fromPort: 'right', to: 'tag_engaged' },
            { from: 'condition_open', fromPort: 'left', to: 'tag_cold' },
            { from: 'tag_engaged', to: 'end_true' },
            { from: 'tag_cold', to: 'end_false' },
          ],
        },
      })
      .expect(200);

    const triggerOpenResponse = await request(app.getHttpServer())
      .post(`/automations/${conditionAutomationId}/trigger`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contactId: contactWithOpenId })
      .expect(201);

    await automationsService.executeQueuedAutomation({
      automationId: conditionAutomationId,
      executionId: triggerOpenResponse.body.id as string,
      contactId: contactWithOpenId,
    });

    const triggerNoOpenResponse = await request(app.getHttpServer())
      .post(`/automations/${conditionAutomationId}/trigger`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contactId: contactWithoutOpenId })
      .expect(201);

    await automationsService.executeQueuedAutomation({
      automationId: conditionAutomationId,
      executionId: triggerNoOpenResponse.body.id as string,
      contactId: contactWithoutOpenId,
    });

    const refreshedContactWithOpen = await prisma.contact.findUnique({
      where: { id: contactWithOpenId },
    });
    const refreshedContactWithoutOpen = await prisma.contact.findUnique({
      where: { id: contactWithoutOpenId },
    });

    const withOpenTags = Array.isArray(refreshedContactWithOpen?.tags)
      ? (refreshedContactWithOpen?.tags as string[])
      : [];
    const withoutOpenTags = Array.isArray(refreshedContactWithoutOpen?.tags)
      ? (refreshedContactWithoutOpen?.tags as string[])
      : [];

    expect(withOpenTags).toContain('engaged');
    expect(withOpenTags).not.toContain('cold');
    expect(withoutOpenTags).toContain('cold');
    expect(withoutOpenTags).not.toContain('engaged');
  });

  it('applies tagMode add and remove in workflow execution', async () => {
    const contactResponse = await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Tag',
        lastName: 'Mode',
        email: `tag-mode-${Date.now()}@novasms.test`,
      })
      .expect(201);

    const tagContactId = contactResponse.body.id as string;

    await prisma.contact.update({
      where: { id: tagContactId },
      data: { tags: ['vip', 'legacy'] },
    });

    const addAutomationResponse = await request(app.getHttpServer())
      .post('/automations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Tag Add E2E',
        trigger: 'api',
        delaySeconds: 0,
        channel: 'Email',
        status: 'Active',
      })
      .expect(201);

    const addAutomationId = addAutomationResponse.body.id as string;

    await request(app.getHttpServer())
      .patch(`/automations/${addAutomationId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        workflow: {
          startNodeId: 'trigger_add',
          nodes: [
            { id: 'trigger_add', type: 'trigger' },
            {
              id: 'tag_add',
              type: 'tag',
              config: { tag: 'loyal', tagMode: 'add' },
            },
            { id: 'end_add', type: 'end' },
          ],
          edges: [
            { from: 'trigger_add', to: 'tag_add' },
            { from: 'tag_add', to: 'end_add' },
          ],
        },
      })
      .expect(200);

    const addTriggerResponse = await request(app.getHttpServer())
      .post(`/automations/${addAutomationId}/trigger`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contactId: tagContactId })
      .expect(201);

    await automationsService.executeQueuedAutomation({
      automationId: addAutomationId,
      executionId: addTriggerResponse.body.id as string,
      contactId: tagContactId,
    });

    const afterAddContact = await prisma.contact.findUnique({
      where: { id: tagContactId },
    });

    const afterAddTags = Array.isArray(afterAddContact?.tags)
      ? (afterAddContact?.tags as string[])
      : [];

    expect(afterAddTags).toContain('loyal');
    expect(afterAddTags).toContain('vip');

    const removeAutomationResponse = await request(app.getHttpServer())
      .post('/automations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Tag Remove E2E',
        trigger: 'api',
        delaySeconds: 0,
        channel: 'Email',
        status: 'Active',
      })
      .expect(201);

    const removeAutomationId = removeAutomationResponse.body.id as string;

    await request(app.getHttpServer())
      .patch(`/automations/${removeAutomationId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        workflow: {
          startNodeId: 'trigger_remove',
          nodes: [
            { id: 'trigger_remove', type: 'trigger' },
            {
              id: 'tag_remove',
              type: 'tag',
              config: { tag: 'vip', tagMode: 'remove' },
            },
            { id: 'end_remove', type: 'end' },
          ],
          edges: [
            { from: 'trigger_remove', to: 'tag_remove' },
            { from: 'tag_remove', to: 'end_remove' },
          ],
        },
      })
      .expect(200);

    const removeTriggerResponse = await request(app.getHttpServer())
      .post(`/automations/${removeAutomationId}/trigger`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contactId: tagContactId })
      .expect(201);

    await automationsService.executeQueuedAutomation({
      automationId: removeAutomationId,
      executionId: removeTriggerResponse.body.id as string,
      contactId: tagContactId,
    });

    const afterRemoveContact = await prisma.contact.findUnique({
      where: { id: tagContactId },
    });

    const afterRemoveTags = Array.isArray(afterRemoveContact?.tags)
      ? (afterRemoveContact?.tags as string[])
      : [];

    expect(afterRemoveTags).toContain('loyal');
    expect(afterRemoveTags).not.toContain('vip');
  });
});
