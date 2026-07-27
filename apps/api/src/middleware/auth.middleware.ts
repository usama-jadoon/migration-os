import { Request, Response, NextFunction } from 'express';
import { getSession } from '../utils/auth';
import { prisma } from '../utils/db';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
  session?: {
    id: string;
    token: string;
    organizationId: string | null;
  };
  organizationId?: string;
  membership?: {
    role: string;
  };
}

export async function authenticateSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').reduce((acc: Record<string, string>, c) => {
        const [k, v] = c.trim().split('=');
        if (k && v) acc[k] = decodeURIComponent(v);
        return acc;
      }, {});
      token = cookies['auth_token'];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Missing token.' });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid.' });
    }

    req.user = session.user;
    req.session = {
      id: session.id,
      token: session.token,
      organizationId: session.organizationId,
    };

    if (session.organizationId) {
      req.organizationId = session.organizationId;
      const membership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: session.organizationId,
            userId: session.user.id,
          },
        },
      });

      if (membership) {
        req.membership = { role: membership.role };
      }
    }

    next();
  } catch (err: any) {
    logger.error('[AuthMiddleware] Error during session authentication:', { error: err.message });
    return res.status(500).json({ error: 'Internal authentication error' });
  }
}

export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.membership) {
      return res.status(403).json({ error: 'Forbidden. User is not a member of the active organization.' });
    }

    if (!allowedRoles.includes(req.membership.role)) {
      logger.warn(`[RBAC] Access denied for user ${req.user.id} with role ${req.membership.role}. Required: ${allowedRoles.join(', ')}`);
      
      // Log audit entry for authorization denial
      prisma.auditLog.create({
        data: {
          organizationId: req.organizationId,
          userId: req.user.id,
          action: 'authorization_denial',
          details: JSON.stringify({
            path: req.originalUrl,
            method: req.method,
            userRole: req.membership.role,
            requiredRoles: allowedRoles,
          }),
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        },
      }).catch(() => {});

      return res.status(403).json({ error: 'Forbidden. Insufficient permissions for this operation.' });
    }

    next();
  };
}
