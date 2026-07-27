import { Router, Response } from 'express';
import { z } from 'zod';
import { complianceService } from '../services/compliance.service';
import { authenticateSession, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

export const complianceRoutes = Router();

complianceRoutes.use(authenticateSession);

const retentionPurgeSchema = z.object({
  retentionDays: z.number().min(1).max(3650),
});

const dataErasureSchema = z.object({
  targetUserId: z.string().uuid().optional(),
});

complianceRoutes.get('/audit-logs', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, userId, startDate, endDate, format, page, limit } = req.query;

    if (format === 'csv') {
      const csvData = await complianceService.exportAuditLogsCsv(req.organizationId!);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${Date.now()}.csv`);
      return res.status(200).send(csvData);
    }

    const logs = await complianceService.getAuditLogs({
      organizationId: req.organizationId!,
      action: action as string | undefined,
      userId: userId as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });

    return res.json(logs);
  } catch (err: any) {
    logger.error('[ComplianceRoute] Get audit logs error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

complianceRoutes.post('/retention-purge', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = retentionPurgeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { retentionDays } = parseResult.data;
    const purgedCount = await complianceService.purgeExpiredAuditLogs(req.organizationId!, retentionDays);

    return res.json({
      message: `Successfully purged audit logs older than ${retentionDays} days`,
      purgedCount,
    });
  } catch (err: any) {
    logger.error('[ComplianceRoute] Retention purge error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to purge audit logs' });
  }
});

complianceRoutes.post('/data-erasure', requireRole(['owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = dataErasureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { targetUserId } = parseResult.data;
    const results = await complianceService.executeDataErasure(req.organizationId!, targetUserId);

    return res.json({
      message: 'GDPR / Right to be Forgotten Data Erasure executed successfully',
      results,
    });
  } catch (err: any) {
    logger.error('[ComplianceRoute] Data erasure error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to execute data erasure' });
  }
});
