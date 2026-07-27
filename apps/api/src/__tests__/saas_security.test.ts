import request from 'supertest';
import express from 'express';
import { migrationRoutes } from '../routes/migrations';
import { authRoutes } from '../routes/auth';
import { organizationRoutes } from '../routes/organizations';
import { prisma } from '../utils/db';
import { runMigration } from '../workers/migration.worker';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/migrations', migrationRoutes);

describe('SaaS Security & Multi-Tenant Isolation Suite', () => {
  let tokenOrgA: string;
  let tokenOrgB: string;
  let tokenViewerOrgA: string;
  let orgAId: string;
  let orgBId: string;
  let migrationIdOrgA: string;

  beforeAll(async () => {
    // Clear test database
    await prisma.session.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.migrationError.deleteMany();
    await prisma.folderMapping.deleteMany();
    await prisma.migration.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    // 1. Register Org A Owner
    const resSignupA = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'owner-orga@example.com',
        password: 'Password123!',
        name: 'Owner OrgA',
        organizationName: 'Organization Alpha',
      });

    expect(resSignupA.status).toBe(201);
    tokenOrgA = resSignupA.body.token;
    orgAId = resSignupA.body.organization.id;

    // 2. Register Org B Owner
    const resSignupB = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'owner-orgb@example.com',
        password: 'Password123!',
        name: 'Owner OrgB',
        organizationName: 'Organization Beta',
      });

    expect(resSignupB.status).toBe(201);
    tokenOrgB = resSignupB.body.token;
    orgBId = resSignupB.body.organization.id;

    // 3. Create Viewer User in Org A
    const resSignupViewer = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'viewer-orga@example.com',
        password: 'Password123!',
        name: 'Viewer OrgA',
        organizationName: 'Temp Org',
      });

    tokenViewerOrgA = resSignupViewer.body.token;

    // Add viewer to Org A
    await request(app)
      .post('/api/organizations/members')
      .set('Authorization', `Bearer ${tokenOrgA}`)
      .send({
        email: 'viewer-orga@example.com',
        role: 'viewer',
      });

    // Switch viewer's session to Org A
    await request(app)
      .post('/api/auth/switch-org')
      .set('Authorization', `Bearer ${tokenViewerOrgA}`)
      .send({ organizationId: orgAId });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Authentication & Session Protection', () => {
    it('should reject unauthenticated API requests with 401', async () => {
      const res = await request(app).get('/api/migrations');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    it('should reject invalid password with 401', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'owner-orga@example.com',
        password: 'WrongPassword',
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
    });

    it('should allow valid user login and return token', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'owner-orga@example.com',
        password: 'Password123!',
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('should allow Org A Owner to create a migration', async () => {
      const res = await request(app)
        .post('/api/migrations')
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          sourceProvider: 'imap',
          sourceEmail: 'src@orga.com',
          destProvider: 'imap',
          destEmail: 'dst@orga.com',
        });

      expect(res.status).toBe(200);
      expect(res.body.organizationId).toBe(orgAId);
      migrationIdOrgA = res.body.id;
    });

    it('should reject migration creation by a Viewer role with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/migrations')
        .set('Authorization', `Bearer ${tokenViewerOrgA}`)
        .send({
          sourceProvider: 'imap',
          sourceEmail: 'src-viewer@orga.com',
          destProvider: 'imap',
          destEmail: 'dst-viewer@orga.com',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Insufficient permissions/i);
    });

    it('should allow Viewer role to read migration status', async () => {
      const res = await request(app)
        .get(`/api/migrations/${migrationIdOrgA}`)
        .set('Authorization', `Bearer ${tokenViewerOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(migrationIdOrgA);
    });
  });

  describe('Multi-Tenant Data & IDOR Isolation', () => {
    it('should prevent Org B from reading Org A migration (Returns 404)', async () => {
      const res = await request(app)
        .get(`/api/migrations/${migrationIdOrgA}`)
        .set('Authorization', `Bearer ${tokenOrgB}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Migration not found/i);
    });

    it('should prevent Org B from starting Org A migration (Returns 404)', async () => {
      const res = await request(app)
        .post(`/api/migrations/${migrationIdOrgA}/start`)
        .set('Authorization', `Bearer ${tokenOrgB}`);

      expect(res.status).toBe(404);
    });

    it('should prevent Org B from reading Org A migration errors (Returns 404)', async () => {
      const res = await request(app)
        .get(`/api/migrations/${migrationIdOrgA}/errors`)
        .set('Authorization', `Bearer ${tokenOrgB}`);

      expect(res.status).toBe(404);
    });

    it('should strip encrypted credential fields from API responses', async () => {
      await request(app)
        .post(`/api/migrations/${migrationIdOrgA}/credentials`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          sourceCredentials: { user: 'src', password: 'secretPassword123' },
          destCredentials: { user: 'dst', password: 'secretPassword456' },
        });

      const res = await request(app)
        .get(`/api/migrations/${migrationIdOrgA}`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.sourceCredentials).toBeUndefined();
      expect(res.body.destCredentials).toBeUndefined();
    });
  });

  describe('Worker Tenant Isolation', () => {
    it('should refuse worker execution when organizationId is mismatched', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      // Run worker passing mismatched tenant ID
      await runMigration(migrationIdOrgA, orgBId);

      const migration = await prisma.migration.findUnique({ where: { id: migrationIdOrgA } });
      // Status should remain draft/validating and not transition to running
      expect(migration?.status).not.toBe('running');
      logSpy.mockRestore();
    });
  });
});
