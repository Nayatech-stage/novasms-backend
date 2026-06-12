import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

const supertest = require('supertest') as typeof import('supertest');

// ─── Helpers ────────────────────────────────────────────────────────────────

function hmacHex(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function stripeSignatureHeader(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = hmacHex(`${timestamp}.${body}`, secret);
  return `t=${timestamp},v1=${sig}`;
}

// ─── Shared mock ────────────────────────────────────────────────────────────

const mockWebhookService = {
  receiveWebhook: jest.fn().mockResolvedValue({
    id: 'wh-1',
    campaignId: 'c-1',
    event: 'email.sent',
    payload: {},
    receivedAt: new Date(),
    processed: true,
  }),
  receiveResendWebhook: jest.fn().mockResolvedValue({ id: 'wh-2' }),
  receiveSmsWebhook: jest.fn().mockResolvedValue({ id: 'wh-3' }),
  receiveStripeWebhook: jest.fn().mockResolvedValue({ id: 'wh-4' }),
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('WebhookController – HMAC signature hardening (US-020)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: mockWebhookService }],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset secrets between tests
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.AFRICASTALKING_WEBHOOK_SECRET;
    delete process.env.TWILIO_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  // ── /webhooks/email-events ──────────────────────────────────────────────

  describe('POST /webhooks/email-events', () => {
    const payload = {
      event: 'email.sent',
      campaignId: 'c-1',
      contactId: 'u-1',
      timestamp: new Date().toISOString(),
    };

    it('accepts request when no secret is configured (open endpoint)', async () => {
      await supertest(app.getHttpServer())
        .post('/webhooks/email-events')
        .send(payload)
        .expect(201);

      expect(mockWebhookService.receiveWebhook).toHaveBeenCalledTimes(1);
    });

    it('rejects (400) when secret is set but signature header is missing', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'supersecret';

      await supertest(app.getHttpServer())
        .post('/webhooks/email-events')
        .send(payload)
        .expect(400);

      expect(mockWebhookService.receiveWebhook).not.toHaveBeenCalled();
    });

    it('rejects (400) when secret is set and signature is wrong', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'supersecret';

      await supertest(app.getHttpServer())
        .post('/webhooks/email-events')
        .set('x-resend-signature', 'deadbeef')
        .send(payload)
        .expect(400);
    });

    it('accepts request when secret is set and HMAC-SHA256 signature is correct', async () => {
      const secret = 'supersecret';
      process.env.RESEND_WEBHOOK_SECRET = secret;

      // In the test, rawBody is not set on req → controller falls back to JSON.stringify(payload)
      const body = JSON.stringify(payload);
      const signature = hmacHex(body, secret);

      await supertest(app.getHttpServer())
        .post('/webhooks/email-events')
        .set('x-resend-signature', signature)
        .send(payload)
        .expect(201);

      expect(mockWebhookService.receiveWebhook).toHaveBeenCalledTimes(1);
    });
  });

  // ── /webhooks/resend ────────────────────────────────────────────────────

  describe('POST /webhooks/resend', () => {
    const payload = { type: 'email.sent', data: { email_id: 'xyz' } };

    it('accepts when no secret configured', async () => {
      await supertest(app.getHttpServer())
        .post('/webhooks/resend')
        .send(payload)
        .expect(201);
    });

    it('rejects (400) with secret but no header', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'resend-secret';

      await supertest(app.getHttpServer())
        .post('/webhooks/resend')
        .send(payload)
        .expect(400);
    });

    it('accepts with correct HMAC', async () => {
      const secret = 'resend-secret';
      process.env.RESEND_WEBHOOK_SECRET = secret;

      const body = JSON.stringify(payload);
      const signature = hmacHex(body, secret);

      await supertest(app.getHttpServer())
        .post('/webhooks/resend')
        .set('x-resend-signature', signature)
        .send(payload)
        .expect(201);
    });
  });

  // ── /webhooks/africastalking ─────────────────────────────────────────────

  describe('POST /webhooks/africastalking', () => {
    const payload = { messageId: 'at-1', status: 'Success' };

    it('accepts when no secret configured', async () => {
      await supertest(app.getHttpServer())
        .post('/webhooks/africastalking')
        .send(payload)
        .expect(201);
    });

    it('rejects (400) with secret but no header', async () => {
      process.env.AFRICASTALKING_WEBHOOK_SECRET = 'at-secret';

      await supertest(app.getHttpServer())
        .post('/webhooks/africastalking')
        .send(payload)
        .expect(400);
    });

    it('accepts with correct HMAC on x-africastalking-signature', async () => {
      const secret = 'at-secret';
      process.env.AFRICASTALKING_WEBHOOK_SECRET = secret;

      const body = JSON.stringify(payload);
      const signature = hmacHex(body, secret);

      await supertest(app.getHttpServer())
        .post('/webhooks/africastalking')
        .set('x-africastalking-signature', signature)
        .send(payload)
        .expect(201);
    });
  });

  // ── /webhooks/twilio ─────────────────────────────────────────────────────

  describe('POST /webhooks/twilio', () => {
    const payload = { MessageSid: 'SM-1', MessageStatus: 'delivered' };

    it('accepts when no secret configured', async () => {
      await supertest(app.getHttpServer())
        .post('/webhooks/twilio')
        .send(payload)
        .expect(201);
    });

    it('rejects (400) with secret but no header', async () => {
      process.env.TWILIO_WEBHOOK_SECRET = 'twilio-secret';

      await supertest(app.getHttpServer())
        .post('/webhooks/twilio')
        .send(payload)
        .expect(400);
    });

    it('accepts with correct HMAC on x-twilio-signature', async () => {
      const secret = 'twilio-secret';
      process.env.TWILIO_WEBHOOK_SECRET = secret;

      const body = JSON.stringify(payload);
      const signature = hmacHex(body, secret);

      await supertest(app.getHttpServer())
        .post('/webhooks/twilio')
        .set('x-twilio-signature', signature)
        .send(payload)
        .expect(201);
    });
  });

  // ── /webhooks/stripe ─────────────────────────────────────────────────────

  describe('POST /webhooks/stripe (Stripe format: t=…,v1=…)', () => {
    const payload = { type: 'payment_intent.succeeded', data: {} };

    it('accepts when no secret configured', async () => {
      await supertest(app.getHttpServer())
        .post('/webhooks/stripe')
        .send(payload)
        .expect(201);
    });

    it('rejects (400) with secret but stripe-signature header missing', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'stripe-secret';

      await supertest(app.getHttpServer())
        .post('/webhooks/stripe')
        .send(payload)
        .expect(400);
    });

    it('rejects (400) with malformed stripe-signature (no t= / v1=)', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'stripe-secret';

      await supertest(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 'invalid-format')
        .send(payload)
        .expect(400);
    });

    it('rejects (400) with wrong v1 signature', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'stripe-secret';

      await supertest(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1234567890,v1=deadbeefdeadbeef')
        .send(payload)
        .expect(400);
    });

    it('accepts with correct Stripe t=…,v1=… format', async () => {
      const secret = 'stripe-secret';
      process.env.STRIPE_WEBHOOK_SECRET = secret;

      // The controller uses JSON.stringify(payload) as rawBody when req.rawBody is absent
      const body = JSON.stringify(payload);
      const header = stripeSignatureHeader(body, secret);

      await supertest(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', header)
        .send(payload)
        .expect(201);

      expect(mockWebhookService.receiveStripeWebhook).toHaveBeenCalledTimes(1);
    });
  });
});
