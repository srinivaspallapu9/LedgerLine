import { Router, Request, Response } from 'express';
import { AccountService } from '../services/account.service';
import { createAccountSchema, recipientVerificationSchema, updateAccountStatusSchema } from '../validation/schemas';
import { authenticateToken, requireRole } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { recipientVerificationRateLimiter } from '../middleware/rate-limiter';

const router = Router();

router.use(authenticateToken);

router.post(
  '/recipients/verify',
  requireRole(UserRole.ACCOUNT_HOLDER),
  recipientVerificationRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const { accountNumber } = recipientVerificationSchema.parse(req.body);
      const recipient = await AccountService.verifyRecipient(accountNumber);
      res.json({ success: true, data: { recipient } });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Recipient account number is invalid.',
            details: error.issues,
          },
        });
      }
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        error: { code: error.code || 'INTERNAL_ERROR', message: error.message },
      });
    }
  }
);

// List accounts (customer gets own; admin/auditor can view all)
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (user.role === UserRole.ACCOUNT_HOLDER) {
      const accounts = await AccountService.getUserAccounts(user.id);
      return res.json({ success: true, data: { accounts } });
    }

    // Admin or Auditor
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const search = req.query.search as string;
    const status = req.query.status as any;
    const type = req.query.type as any;

    const result = await AccountService.getAllAccounts({ page, limit, search, status, type });
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

// Create new customer account
router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = createAccountSchema.parse(req.body);
    const user = req.user!;
    const targetUserId = validated.userId || user.id;

    const result = await AccountService.createAccount({
      userId: targetUserId,
      accountType: validated.accountType,
      actorUserId: user.id,
      actorRole: user.role,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ success: true, data: { account: result } });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

// Get account detail with ledger reconciliation
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const accountId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const account = await AccountService.getAccountById(accountId, req.user!.id, req.user!.role);
    res.json({ success: true, data: { account } });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

// Update account status (Admin only)
router.patch('/:id/status', requireRole(UserRole.ADMIN), async (req: Request, res: Response) => {
  try {
    const validated = updateAccountStatusSchema.parse(req.body);
    const accountId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await AccountService.updateAccountStatus({
      accountId,
      newStatus: validated.status,
      actorUserId: req.user!.id,
      reason: validated.reason,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, data: { account: result } });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

export const accountRouter = router;
