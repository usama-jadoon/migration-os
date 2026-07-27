import { Router, Response } from 'express';
import { z } from 'zod';
import { google } from 'googleapis';
import { prisma } from '../utils/db';
import { hashPassword, verifyPassword, createSession } from '../utils/auth';
import { authenticateSession, AuthenticatedRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

export const authRoutes = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  organizationName: z.string().min(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRoutes.post('/signup', async (req, res) => {
  try {
    const parseResult = signupSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { email, password, name, organizationName } = parseResult.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const passwordHash = hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
    });

    const orgName = organizationName || `${name}'s Organization`;
    const slug = `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;

    const org = await prisma.organization.create({
      data: {
        name: orgName,
        slug,
        memberships: {
          create: {
            userId: user.id,
            role: 'owner',
          },
        },
      },
    });

    const session = await createSession(user.id, org.id);

    res.cookie('auth_token', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        action: 'user_signup',
        details: JSON.stringify({ email: user.email, orgId: org.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: org.id, name: org.name, slug: org.slug, role: 'owner' },
      token: session.token,
    });
  } catch (err: any) {
    logger.error('[AuthRoute] Signup error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error during signup' });
  }
});

authRoutes.post('/login', async (req, res) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { organization: true },
        },
      },
    });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      await prisma.auditLog.create({
        data: {
          action: 'login_failed',
          details: JSON.stringify({ email }),
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        },
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const primaryMembership = user.memberships[0];
    const activeOrgId = primaryMembership ? primaryMembership.organizationId : undefined;

    const session = await createSession(user.id, activeOrgId);

    res.cookie('auth_token', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await prisma.auditLog.create({
      data: {
        organizationId: activeOrgId,
        userId: user.id,
        action: 'user_login',
        details: JSON.stringify({ email: user.email }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    return res.json({
      user: { id: user.id, email: user.email, name: user.name },
      organization: primaryMembership ? {
        id: primaryMembership.organization.id,
        name: primaryMembership.organization.name,
        slug: primaryMembership.organization.slug,
        role: primaryMembership.role,
      } : null,
      token: session.token,
    });
  } catch (err: any) {
    logger.error('[AuthRoute] Login error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

authRoutes.post('/logout', authenticateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.session) {
      await prisma.session.delete({ where: { id: req.session.id } }).catch(() => {});
    }

    res.clearCookie('auth_token');

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          organizationId: req.organizationId,
          userId: req.user.id,
          action: 'user_logout',
          details: JSON.stringify({ userId: req.user.id }),
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        },
      });
    }

    return res.json({ message: 'Logged out successfully' });
  } catch (err: any) {
    logger.error('[AuthRoute] Logout error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error during logout' });
  }
});

authRoutes.get('/me', authenticateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: req.user!.id },
      include: { organization: true },
    });

    const activeOrg = memberships.find((m) => m.organizationId === req.organizationId) || memberships[0];

    return res.json({
      user: req.user,
      activeOrganization: activeOrg ? {
        id: activeOrg.organization.id,
        name: activeOrg.organization.name,
        slug: activeOrg.organization.slug,
        role: activeOrg.role,
      } : null,
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
    });
  } catch (err: any) {
    logger.error('[AuthRoute] Get me error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRoutes.post('/switch-org', authenticateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }

    const membership = await prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: req.user!.id,
        },
      },
      include: { organization: true },
    });

    if (!membership) {
      return res.status(403).json({ error: 'User is not a member of the requested organization' });
    }

    await prisma.session.update({
      where: { id: req.session!.id },
      data: { organizationId },
    });

    return res.json({
      message: 'Active organization updated',
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      },
    });
  } catch (err: any) {
    logger.error('[AuthRoute] Switch org error:', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Google OAuth 2.0 Endpoints
authRoutes.get('/google/url', authenticateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/google/callback';

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'Google OAuth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.',
      });
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const scopes = [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: req.organizationId,
    });

    return res.json({ url });
  } catch (err: any) {
    logger.error('[AuthRoute] Google OAuth URL generation error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to generate Google OAuth URL' });
  }
});

authRoutes.post('/google/token', authenticateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/google/callback';

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'Google OAuth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.',
      });
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    return res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
    });
  } catch (err: any) {
    logger.error('[AuthRoute] Google OAuth token exchange error:', { error: err.message });
    return res.status(400).json({ error: 'Failed to exchange Google OAuth code for tokens', details: err.message });
  }
});