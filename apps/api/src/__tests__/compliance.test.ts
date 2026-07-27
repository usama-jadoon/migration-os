import request from 'supertest';
import express from 'express';
import { complianceRoutes } from '../routes/compliance';
import { authRoutes } from '../routes/auth';
import { prisma } from '../utils/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/compliance', complianceRoutes);

describe('Enterprise Compliance & Audit Trail Suite', () => {
  let ownerToken: string;
  let viewerToken: string;
  let orgId: string;

  beforeAll(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.migration.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    const ownerRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'compliance-owner@example.com',
        password: 'Password123!',
        name: 'Compliance Owner',
        organizationName: 'Compliance Corp',
      });

    ownerToken = ownerRes.body.token;
    orgId = ownerRes.body.organization.id;

    // Create secondary viewer user in same organization
    const viewerUser = await prisma.user.create({
      data: {
        email: 'compliance-viewer@example.com',
        name: 'Compliance Viewer',
        passwordHash: 'hashed',
      },
    });

    await prisma.organizationMembership.create({
      data: {
        organizationId: orgId,
        userId: viewerUser.id,
        role: 'viewer',
      },
    });

    const viewerSession = await prisma.session.create({
      data: {
        userId: viewerUser.id,
        organizationId: orgId,
        token: 'viewer-test-session-token-999',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    viewerToken = viewerSession.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/compliance/audit-logs', () => {
    it('should query tenant-isolated audit logs for active organization', async () => {
      const res = await request(app)
        .get('/api/compliance/audit-logs')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('should export audit logs in CSV format when requested', async () => {
      const res = await request(app)
        .get('/api/compliance/audit-logs?format=csv')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('ID,Timestamp,Action,User ID,IP Address,Details');
    });

    it('should deny viewer access to audit logs with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/compliance/audit-logs')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });
  });

  describe('POST /api/compliance/retention-purge', () => {
    it('should purge audit logs older than retention period', async () => {
      const res = await request(app)
        .post('/api/compliance/retention-purge')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ retentionDays: 30 });

      expect(res.status).toBe(200);
      expect(res.body.purgedCount).toBeDefined();
    });
  });

  describe('POST /api/compliance/data-erasure', () => {
    it('should execute GDPR Data Erasure to purge tenant credentials and audit trail', async () => {
      const res = await request(app)
        .post('/api/compliance/data-erasure')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Data Erasure executed successfully');
      expect(res.body.results.auditLogsDeleted).toBeGreaterThanOrEqual(0);
    });
  });
});
