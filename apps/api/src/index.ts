import 'dotenv/config';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { migrationRoutes } from './routes/migrations';
import { authRoutes } from './routes/auth';
import { providerRoutes } from './routes/providers';
import { organizationRoutes } from './routes/organizations';
import { checkDbHealth } from './utils/db';
import { migrationQueue } from './queues/migration.queue';
import { logger } from './utils/logger';
import { getSession } from './utils/auth';
import { prisma } from './utils/db';
import './workers/migration.worker';

const app = express();
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Socket.io Authentication & Tenant Room Isolation Middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.cookie?.split(';').reduce((acc: Record<string, string>, c) => {
      const [k, v] = c.trim().split('=');
      if (k && v) acc[k] = decodeURIComponent(v);
      return acc;
    }, {})['auth_token'];

    if (!token) {
      return next(new Error('Authentication required for socket connection'));
    }

    const session = await getSession(token);
    if (!session || !session.organizationId) {
      return next(new Error('Invalid or expired socket session'));
    }

    socket.data.userId = session.user.id;
    socket.data.organizationId = session.organizationId;
    socket.join(`org:${session.organizationId}`);
    next();
  } catch (err: any) {
    logger.error('[SocketAuth] Socket authentication failed:', { error: err.message });
    return next(new Error('Socket authentication error'));
  }
});

io.on('connection', (socket) => {
  logger.info(`[Socket] Authenticated client connected: user=${socket.data.userId}, org=${socket.data.organizationId}`);

  socket.on('join:migration', async (migrationId: string) => {
    try {
      const migration = await prisma.migration.findFirst({
        where: { id: migrationId, organizationId: socket.data.organizationId },
      });

      if (migration) {
        const roomName = `migration:${socket.data.organizationId}:${migrationId}`;
        socket.join(roomName);
        logger.info(`[Socket] User ${socket.data.userId} joined authorized room ${roomName}`);
      } else {
        logger.warn(`[Socket] Tenant isolation blocked unauthorized room join for migration ${migrationId}`);
      }
    } catch (err: any) {
      logger.error('[Socket] Room join error:', { error: err.message });
    }
  });
});

app.get('/health', async (req, res) => {
  const dbHealth = await checkDbHealth();
  const healthy = dbHealth.healthy;

  const responsePayload = {
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: dbHealth,
    queue: {
      provider: migrationQueue.getProvider(),
    },
    version: '1.0.0',
  };

  res.status(healthy ? 200 : 503).json(responsePayload);
});

app.use('/api/migrations', migrationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/organizations', organizationRoutes);

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`);
  });
}