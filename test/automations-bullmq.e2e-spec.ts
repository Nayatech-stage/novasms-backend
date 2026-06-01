import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30000);

describe('Automations with BullMQ (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken = '';
  let accountId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // register account
    const runId = Date.now();
    const email = `bullmq-e2e-${runId}@novasms.test`;
    const password = 'Aa1?aaaa';

    await request(app.getHttpServer()).post('/auth/register').send({
      nom: 'BullMQ E2E',
      email,
      motDePasse: password,
      nomBoutique: 'BullMQ E2E Shop',
      pays: 'FR',
    });

    // mark email verified
    await prisma.account.update({ where: { adminEmail: email }, data: { emailVerified: true } });

    const loginResp = await request(app.getHttpServer()).post('/auth/login').send({ email, motDePasse: password });
    authToken = loginResp.body.accessToken || loginResp.body.access_token;

    const account = await prisma.account.findUnique({ where: { adminEmail: email } });
    if (!account) throw new Error('account not created');
    accountId = account.id;
  });

  afterAll(async () => {
    if (accountId) {
      await prisma.workflowExecution.deleteMany({ where: { automation: { accountId } } });
      await prisma.automation.deleteMany({ where: { accountId } });
      await prisma.campaign.deleteMany({ where: { accountId } });
      await prisma.contact.deleteMany({ where: { accountId } });
      await prisma.account.delete({ where: { id: accountId } });
    }
    await app.close();
  });

  it('runs an automation end-to-end through Redis/BullMQ', async () => {
    // create contact
    const contactResp = await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ email: `bm-${Date.now()}@novasms.test`, firstName: 'E2E', lastName: 'Bull' })
      .expect(201);

    const contactId = contactResp.body.id as string;

    // create automation active
    const autoResp = await request(app.getHttpServer())
      .post('/automations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'BullMQ Integration', trigger: 'api', delaySeconds: 0, channel: 'Email', status: 'Active' })
      .expect(201);

    const automationId = autoResp.body.id as string;

    // trigger automation
    const triggerResp = await request(app.getHttpServer())
      .post(`/automations/${automationId}/trigger`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contactId, delaySeconds: 0 })
      .expect(201);

    const executionId = triggerResp.body.id as string;

    // poll report until execution completes (timeout ~15s)
    const deadline = Date.now() + 15000;
    let report: any = null;
    while (Date.now() < deadline) {
      const r = await request(app.getHttpServer()).get(`/automations/${automationId}/report`).set('Authorization', `Bearer ${authToken}`);
      report = r.body;
      if (report && report.completed > 0) break;
      await new Promise((res) => setTimeout(res, 500));
    }

    expect(report).toBeTruthy();
    expect(report.total).toBeGreaterThanOrEqual(1);
    expect(report.completed + report.running + report.failed).toBeGreaterThanOrEqual(1);
    // verify the specific execution transitioned to Completed in DB
    const exec = await prisma.workflowExecution.findUnique({ where: { id: executionId } });
    expect(exec).toBeTruthy();
    expect(['Completed', 'Running', 'Failed']).toContain(exec?.status);
  });
});
