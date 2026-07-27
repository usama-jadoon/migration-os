import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/db';
import { authenticateSession, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

export const organizationRoutes = Router();

organizationRoutes.use(authenticateSession);

const createOrgSchema = z.object({
  name: z.string().min(2),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'operator', 'viewer']),
});

organizationRoutes.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = createOrgSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { name } = parseResult.data;
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;

    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        memberships: {
          create: {
            userId: req.user!.id,
            role: 'owner',
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: req.user!.id,
        action: 'create_organization',
        details: JSON.stringify({ name, slug }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    return res.status(201).json({ id: org.id, name: org.name, slug: org.slug, role: 'owner' });
  } catch (err: any) {
    logger.error('[OrgRoute] Create error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

organizationRoutes.get('/members', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: req.organizationId! },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return res.json(members.map((m) => ({
      id: m.id,
      role: m.role,
      user: m.user,
      createdAt: m.createdAt,
    })));
  } catch (err: any) {
    logger.error('[OrgRoute] Get members error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

organizationRoutes.post('/members', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = addMemberSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { email, role } = parseResult.data;
    const targetUser = await prisma.user.findUnique({ where: { email } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User with specified email not found' });
    }

    const existingMembership = await prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: req.organizationId!,
          userId: targetUser.id,
        },
      },
    });

    if (existingMembership) {
      return res.status(400).json({ error: 'User is already a member of this organization' });
    }

    const membership = await prisma.organizationMembership.create({
      data: {
        organizationId: req.organizationId!,
        userId: targetUser.id,
        role,
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId!,
        userId: req.user!.id,
        action: 'add_member',
        details: JSON.stringify({ targetUserId: targetUser.id, role }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    return res.status(201).json({
      id: membership.id,
      role: membership.role,
      user: membership.user,
      createdAt: membership.createdAt,
    });
  } catch (err: any) {
    logger.error('[OrgRoute] Add member error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});
