import request from 'supertest';
import express from 'express';
import { billingRoutes } from '../routes/billing';
import { migrationRoutes } from '../routes/migrations';
import { authRoutes } from '../routes/auth';
import { prisma } from '../utils/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/migrations', migrationRoutes);

describe('Enterprise Billing & Subscription Suite', () => {
  let userToken: string;

  beforeAll(async () => {
    await prisma.subscription.deleteMany();
    await prisma.migration.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'billing-owner@example.com',
        password: 'Password123!',
        name: 'Billing Owner',
        organizationName: 'Acme Enterprises',
      });

    userToken = signupRes.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/billing/subscription', () => {
    it('should retrieve auto-created default Free plan subscription and limits', async () => {
      const res = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.plan).toBe('free');
      expect(res.body.limits.maxMailboxes).toBe(5);
      expect(res.body.limits.maxConcurrentJobs).toBe(1);
    });
  });

  describe('POST /api/billing/checkout & /upgrade', () => {
    it('should generate Stripe Checkout URL for Pro plan', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planTier: 'pro' });

      expect(res.status).toBe(200);
      expect(res.body.url).toBeDefined();
    });

    it('should upgrade plan directly and expand quota limits', async () => {
      const res = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planTier: 'pro' });

      expect(res.status).toBe(200);
      expect(res.body.subscription.plan).toBe('pro');
      expect(res.body.subscription.maxMailboxes).toBe(100);
      expect(res.body.subscription.maxConcurrentJobs).toBe(5);
    });
  });

  describe('Quota Gating & Tier Enforcement', () => {
    it('should enforce mailbox quota and return 402 Payment Required when free limit is exceeded', async () => {
      // Revert to free plan for testing limit
      await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planTier: 'free' });

      // Create 5 migrations (the Free limit)
      for (let i = 1; i <= 5; i++) {
        const createRes = await request(app)
          .post('/api/migrations')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            sourceProvider: 'imap',
            sourceEmail: `src_${i}@example.com`,
            destProvider: 'imap',
            destEmail: `dst_${i}@example.com`,
          });
        expect(createRes.status).toBe(200);
      }

      // Attempting 6th migration should fail with 402 Payment Required
      const res6 = await request(app)
        .post('/api/migrations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourceProvider: 'imap',
          sourceEmail: 'src_6@example.com',
          destProvider: 'imap',
          destEmail: 'dst_6@example.com',
        });

      expect(res6.status).toBe(402);
      expect(res6.body.error).toBe('Payment Required');
      expect(res6.body.message).toContain('Mailbox quota reached');
    });

    it('should allow migration creation after upgrading to Pro plan', async () => {
      await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planTier: 'pro' });

      const res6 = await request(app)
        .post('/api/migrations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourceProvider: 'imap',
          sourceEmail: 'src_6@example.com',
          destProvider: 'imap',
          destEmail: 'dst_6@example.com',
        });

      expect(res6.status).toBe(200);
      expect(res6.body.id).toBeDefined();
    });
  });

  describe('POST /api/billing/webhook', () => {
    it('should handle Stripe checkout.session.completed webhook event', async () => {
      const subRes = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${userToken}`);

      const orgId = subRes.body.subscription.organizationId;

      const webhookRes = await request(app)
        .post('/api/billing/webhook')
        .send({
          type: 'checkout.session.completed',
          data: {
            object: {
              customer: 'cus_test_123',
              subscription: 'sub_test_456',
              metadata: {
                organizationId: orgId,
                planTier: 'enterprise',
              },
            },
          },
        });

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.received).toBe(true);

      const checkSub = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${userToken}`);

      expect(checkSub.body.subscription.plan).toBe('enterprise');
      expect(checkSub.body.subscription.maxMailboxes).toBe(-1); // Unlimited
    });
  });
});
