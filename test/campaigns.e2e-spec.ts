/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument */
/**
 * E2E Test: Campaign Complete Workflow
 * Tests: Channel Selection → Content Editor → Audience → Scheduling → Send
 *
 * Exécution: npm run test:e2e
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60000);

describe('Campaign E2E Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let accountId: string;
  let campaignId: string;
  let segmentId: string;
  let contactId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Setup: Créer un compte de test
    const createAccountRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        companyName: 'Test Company E2E',
        adminEmail: `e2e-test-${Date.now()}@test.local`,
        password: 'Test123!@#',
        country: 'CI',
      });

    accountId = createAccountRes.body.account.id;
    authToken = createAccountRes.body.access_token;

    // Setup: Créer un segment de test
    const createSegmentRes = await request(app.getHttpServer())
      .post('/segments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Segment',
        type: 'manual',
      });

    segmentId = createSegmentRes.body.id;

    // Setup: Créer un contact de test
    const createContactRes = await request(app.getHttpServer())
      .post('/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        email: `test-contact-${Date.now()}@test.local`,
        firstName: 'Test',
        lastName: 'Contact',
      });

    contactId = createContactRes.body.id;
  });

  afterAll(async () => {
    // Cleanup
    if (accountId && prisma) {
      await prisma.campaign.deleteMany({
        where: { accountId },
      });
      await prisma.contact.deleteMany({
        where: { accountId },
      });
      await prisma.segment.deleteMany({
        where: { accountId },
      });
    }
    await app.close();
  });

  describe('📧 Step 1: Create Campaign (Channel Selection)', () => {
    it('should create a new EMAIL campaign', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'E2E Test Campaign',
          channelType: 'EMAIL',
          subject: 'Test Email Campaign',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.channelType).toBe('EMAIL');
      expect(response.body.status).toBe('DRAFT');

      campaignId = response.body.id;
    });

    it('should not allow SMS campaign without STOP variable', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'SMS Campaign No STOP',
          channelType: 'SMS',
          content: 'Hello {{firstName}}',
        });

      // SMS requires STOP variable
      expect(response.status).toBe(400);
    });
  });

  describe('📝 Step 2: Add Campaign Content', () => {
    it('should update campaign with email content', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          contentJson: {
            subject: 'Welcome to Our Service',
            preheader: 'Check out what we have for you',
            blocks: [
              {
                id: 'block-1',
                type: 'text',
                content: {
                  text: 'Hello {{firstName}}, Welcome!',
                },
              },
              {
                id: 'block-2',
                type: 'button',
                content: {
                  text: 'View Details',
                  url: 'https://example.com/details',
                },
              },
            ],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.subject).toBe('Welcome to Our Service');
      expect(response.body.contentJson.blocks).toHaveLength(2);
    });

    it('should estimate campaign cost', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns/sms/calculate-cost')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: 'Hello {{firstName}}, this is a test SMS with STOP to unsubscribe',
          recipientCount: 100,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalCost');
      expect(response.body).toHaveProperty('segmentCount');
      expect(response.body.totalCost).toBeGreaterThan(0);
    });
  });

  describe('👥 Step 3: Select Audience', () => {
    it('should update campaign with segment', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          segmentId,
          estimatedRecipients: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.segmentId).toBe(segmentId);
    });

    it('should validate segment exists', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          segmentId: 'invalid-segment-id',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('⏱️ Step 4: Configure Scheduling', () => {
    it('should schedule campaign for future date', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 2); // +2 heures

      const response = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          scheduledAt: futureDate.toISOString(),
          timezone: 'Africa/Abidjan',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('SCHEDULED');
      expect(new Date(response.body.scheduledAt)).toEqual(futureDate);
    });

    it('should not allow scheduling in the past', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      const response = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          scheduledAt: pastDate.toISOString(),
        });

      expect(response.status).toBe(400);
    });

    it('should configure A/B testing', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}/ab`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          subjectA: 'Version A: Special Offer',
          subjectB: 'Version B: Limited Time Only',
          abSplitPct: 50,
        });

      expect(response.status).toBe(200);
      expect(response.body.subjectA).toBe('Version A: Special Offer');
      expect(response.body.subjectB).toBe('Version B: Limited Time Only');
    });
  });

  describe('📊 Step 5: Campaign List & Retrieval', () => {
    it('should list all campaigns', async () => {
      const response = await request(app.getHttpServer())
        .get('/campaigns')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should get specific campaign by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(campaignId);
      expect(response.body.name).toBe('E2E Test Campaign');
    });

    it('should not allow access to other account campaigns', async () => {
      // Create another account
      const anotherAccountRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: 'Another Company',
          adminEmail: `another-${Date.now()}@test.local`,
          password: 'Test123!@#',
          country: 'CI',
        });

      const anotherToken = anotherAccountRes.body.access_token;

      const response = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${anotherToken}`);

      expect(response.status).toBe(403); // Forbidden
    });
  });

  describe('🚀 Step 6: Campaign Execution', () => {
    it('should send campaign immediately', async () => {
      const response = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/send`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sendImmediately: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('SENDING');
    });

    it('should cancel scheduled campaign', async () => {
      // Create a new campaign to cancel
      const createRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Campaign to Cancel',
          channelType: 'EMAIL',
        });

      const campaignToCancel = createRes.body.id;

      // Schedule it
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 2);

      await request(app.getHttpServer())
        .patch(`/campaigns/${campaignToCancel}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          scheduledAt: futureDate.toISOString(),
        });

      // Cancel it
      const response = await request(app.getHttpServer())
        .delete(`/campaigns/${campaignToCancel}/schedule`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');
    });

    it('should evaluate A/B test winner', async () => {
      // Wait for some sends to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/ab/evaluate`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('winner');
    });
  });

  describe('🗑️ Step 7: Cleanup & Delete', () => {
    it('should delete a draft campaign', async () => {
      const draftCreateRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Draft Campaign To Delete',
          channelType: 'EMAIL',
        });

      const draftCampaignId = draftCreateRes.body.id;

      const response = await request(app.getHttpServer())
        .delete(`/campaigns/${draftCampaignId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);

      // Verify it's deleted
      const getRes = await request(app.getHttpServer())
        .get(`/campaigns/${draftCampaignId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(400);
    });

    it('should reject deleting a sending campaign', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(409);
    });
  });

  describe('🔒 Security & Validation', () => {
    it('should not allow unauthenticated requests', async () => {
      const response = await request(app.getHttpServer()).get('/campaigns');

      expect(response.status).toBe(401);
    });

    it('should validate campaign name length', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'a'.repeat(300), // Too long
          channelType: 'EMAIL',
        });

      expect(response.status).toBe(400);
    });

    it('should validate email format in content', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Invalid Email Campaign',
          channelType: 'EMAIL',
          contentJson: {
            subject: 'Test',
            blocks: [
              {
                type: 'button',
                content: {
                  url: 'not-a-valid-url',
                },
              },
            ],
          },
        });

      expect(response.status).toBe(400);
    });
  });
});
