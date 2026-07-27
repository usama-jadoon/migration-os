import { prisma } from '../utils/db';
import { logger } from '../utils/logger';

export interface AuditLogQueryOptions {
  organizationId: string;
  action?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export class ComplianceService {
  async getAuditLogs(options: AuditLogQueryOptions) {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId: options.organizationId,
    };

    if (options.action) {
      where.action = options.action;
    }
    if (options.userId) {
      where.userId = options.userId;
    }
    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) where.createdAt.gte = options.startDate;
      if (options.endDate) where.createdAt.lte = options.endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportAuditLogsCsv(organizationId: string): Promise<string> {
    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const header = 'ID,Timestamp,Action,User ID,IP Address,Details\n';
    const rows = logs.map((log) => {
      const sanitizedDetails = log.details ? `"${log.details.replace(/"/g, '""')}"` : '""';
      return `${log.id},${log.createdAt.toISOString()},${log.action},${log.userId || ''},${log.ipAddress || ''},${sanitizedDetails}`;
    });

    return header + rows.join('\n');
  }

  async purgeExpiredAuditLogs(organizationId: string, retentionDays: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deleted = await prisma.auditLog.deleteMany({
      where: {
        organizationId,
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    logger.info(`[Compliance] Purged ${deleted.count} audit log records older than ${retentionDays} days for org ${organizationId}`);
    return deleted.count;
  }

  async executeDataErasure(organizationId: string, targetUserId?: string) {
    const results = {
      auditLogsDeleted: 0,
      migrationsPurged: 0,
      credentialsWiped: 0,
    };

    if (targetUserId) {
      // Purge audit logs for specific user
      const logsDel = await prisma.auditLog.deleteMany({
        where: { organizationId, userId: targetUserId },
      });
      results.auditLogsDeleted = logsDel.count;

      // Anonymize user membership
      await prisma.organizationMembership.deleteMany({
        where: { organizationId, userId: targetUserId },
      });
    } else {
      // Complete tenant data purge (GDPR Article 17 / Data Erasure)
      const credsWiped = await prisma.migration.updateMany({
        where: { organizationId },
        data: {
          sourceCredentials: null,
          destCredentials: null,
        },
      });
      results.credentialsWiped = credsWiped.count;

      const logsDel = await prisma.auditLog.deleteMany({
        where: { organizationId },
      });
      results.auditLogsDeleted = logsDel.count;
    }

    await prisma.auditLog.create({
      data: {
        organizationId,
        action: 'data_erasure_executed',
        details: JSON.stringify({ targetUserId, results }),
      },
    });

    return results;
  }
}

export const complianceService = new ComplianceService();
