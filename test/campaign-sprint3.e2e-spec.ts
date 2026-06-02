import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './../src/app.module';

describe('Sprint 3 Campaign API (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const runId = Date.now();
  const email = `sprint3-${runId}@novasms.test`;
  const password = 'NovaSms@123';

  let accessToken = '';
  let campaignId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { adminEmail: email } });
    await prisma.$disconnect();
    await app.close();
  });

  it('runs full Sprint 3 API workflow', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      nom: 'Sprint3 Company',
      email,
      motDePasse: password,
      nomBoutique: 'Sprint3 Boutique',
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

    expect(loginResponse.body.success).toBe(true);
    accessToken = loginResponse.body.accessToken as string;
    expect(accessToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Alice',
        lastName: 'Test',
        email: `alice-${runId}@example.com`,
        phone: `+225070000${(runId % 10000).toString().padStart(4, '0')}`,
      })
      .expect(201);

    const segmentResponse = await request(app.getHttpServer())
      .post('/contacts/segments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Segment Sprint3 ${runId}`,
        logic: 'AND',
        criteria: [],
      })
      .expect(201);

    const segmentId = segmentResponse.body.segment.id as string;
    expect(segmentId).toBeTruthy();

    const createCampaignResponse = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        channelType: 'EMAIL',
        name: `Campaign Sprint3 ${runId}`,
        status: 'DRAFT',
        segmentId,
        subject: 'Sujet A',
        subjectB: 'Sujet B',
        content: 'Bonjour {{firstName}} - code {{promoCode}}',
        promoCode: 'SPRINT3',
      })
      .expect(201);

    campaignId = createCampaignResponse.body.id as string;
    expect(campaignId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/save-draft`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Campaign Sprint3 ${runId}`,
        segmentId,
        subject: 'Sujet A modifie',
        content: 'Contenu mis a jour',
        promoCode: 'SPRINT3-UPDATED',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/send`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ immediateOrScheduled: 'immediate' })
      .expect(201);

    const listCampaigns = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(listCampaigns.body.data)).toBe(true);
    expect(
      listCampaigns.body.data.some(
        (campaign: { id: string }) => campaign.id === campaignId,
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .delete(`/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });
});
