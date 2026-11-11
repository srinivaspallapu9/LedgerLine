import { Router, Request, Response } from 'express';
import { AdminService } from '../services/admin.service';
import { updateUserRoleSchema, updateUserStatusSchema } from '../validation/schemas';
import { authenticateToken, requireRole } from '../middleware/auth';
import { UserRole } from '@prisma/client';

const router = Router();

router.use(authenticateToken);

// Metrics endpoint accessible to ADMIN and AUDITOR
router.get('/metrics', requireRole(UserRole.ADMIN, UserRole.AUDITOR), async (req: Request, res: Response) => {
  try {
    const metrics = await AdminService.getSystemMetrics();
    res.json({ success: true, data: { metrics } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'METRICS_ERROR', message: error.message } });
  }
});

// Audit logs endpoint accessible to ADMIN and AUDITOR
router.get('/audit-logs', requireRole(UserRole.ADMIN, UserRole.AUDITOR), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 30;
    const actorUserId = req.query.actorUserId as string;
    const resourceType = req.query.resourceType as string;
    const outcome = req.query.outcome as string;
    const eventType = req.query.eventType as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await AdminService.getAuditLogs({
      page,
      limit,
      actorUserId,
      resourceType,
      outcome,
      eventType,
      startDate,
      endDate,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'AUDIT_LOG_ERROR', message: error.message } });
  }
});

// User management endpoints strictly ADMIN only
router.get('/users', requireRole(UserRole.ADMIN, UserRole.AUDITOR), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const role = req.query.role as any;
    const isEnabled = req.query.isEnabled !== undefined ? req.query.isEnabled === 'true' : undefined;
    const search = req.query.search as string;

    const result = await AdminService.listUsers({ page, limit, role, isEnabled, search });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'USERS_ERROR', message: error.message } });
  }
});

router.patch('/users/:id/status', requireRole(UserRole.ADMIN), async (req: Request, res: Response) => {
  try {
    const validated = updateUserStatusSchema.parse(req.body);
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await AdminService.setUserStatus({
      targetUserId,
      isEnabled: validated.isEnabled,
      actorUserId: req.user!.id,
      reason: validated.reason,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, data: { user: updated } });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/users/:id/role', requireRole(UserRole.ADMIN), async (req: Request, res: Response) => {
  try {
    const validated = updateUserRoleSchema.parse(req.body);
    const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await AdminService.updateUserRole({
      targetUserId,
      newRole: validated.role,
      actorUserId: req.user!.id,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, data: { user: updated } });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

export const adminRouter = router;
