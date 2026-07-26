import { Router } from 'express';
import { ImapConnector } from '../connectors/imap.connector';

export const providerRoutes = Router();

providerRoutes.post('/imap/test', async (req, res) => {
  try {
    const { host, port, username, password, tls } = req.body;
    
    if (!host || !username || !password) {
      return res.status(400).json({ error: 'Missing required configuration: host, username, password' });
    }

    const connector = new ImapConnector({ host, port, username, password, tls });
    const success = await connector.testConnection();

    if (success) {
      res.json({ status: 'success', message: 'Successfully connected to IMAP server.' });
    } else {
      res.status(400).json({ status: 'error', message: 'Failed to connect to IMAP server with provided credentials.' });
    }
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

providerRoutes.post('/test', (req, res) => {
  res.json({ message: 'Provider test endpoint' });
});