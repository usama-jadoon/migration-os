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
import { checkDbHealth } from './utils/db';
import { migrationQueue } from './queues/migration.queue';
import { logger } from './utils/logger';
import './workers/migration.worker';

const app = express();
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`);
  });
}