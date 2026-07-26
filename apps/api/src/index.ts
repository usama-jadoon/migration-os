import 'dotenv/config';
import path from 'path';
import dotenv from 'dotenv';

// Load root .env file
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { migrationRoutes } from './routes/migrations';
import { authRoutes } from './routes/auth';
import { providerRoutes } from './routes/providers';
import './workers/migration.worker';

const app = express();
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/migrations', migrationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/providers', providerRoutes);

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
  });
}