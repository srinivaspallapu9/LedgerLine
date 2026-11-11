import { Router, Request, Response } from 'express';
import { TransactionService } from '../services/transaction.service';
import { transferSchema, depositSchema, withdrawalSchema } from '../validation/schemas';
import { authenticateToken } from '../middleware/auth';
import { transactionRateLimiter } from '../middleware/rate-limiter';

const router = Router();

router.use(authenticateToken);

// Transfer funds between accounts
router.post('/transfer', transactionRateLimiter, async (req: Request, res: Response) => {
  try {
    const validated = transferSchema.parse(req.body);
    const idempotencyKey = (req.headers['idempotency-key'] as string) || validated.idempotencyKey;
    const amountPaise = BigInt(validated.amountPaise);

    const result = await TransactionService.transfer(
      req.user!.id,
      {
        sourceAccountId: validated.sourceAccountId,
        destinationAccountNumber: validated.destinationAccountNumber,
        amountPaise,
        description: validated.description,
        idempotencyKey,
      },
      req.user!.role,
      req.ip || req.socket.remoteAddress,
      req.headers['user-agent']
    );

    res.status(result.isReplay ? 200 : 201).json({
      success: true,
      isReplay: result.isReplay,
      data: result.data,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Transfer request validation failed.',
          details: error.issues,
        },
      });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'TRANSACTION_FAILED', message: error.message } });
  }
});

// Deposit funds
router.post('/deposit', transactionRateLimiter, async (req: Request, res: Response) => {
  try {
    const validated = depositSchema.parse(req.body);
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    const amountPaise = BigInt(validated.amountPaise);

    const result = await TransactionService.deposit(
      req.user!.id,
      {
        destinationAccountId: validated.destinationAccountId,
        amountPaise,
        description: validated.description,
        idempotencyKey,
      },
      req.user!.role,
      req.ip || req.socket.remoteAddress,
      req.headers['user-agent']
    );

    res.status(result.isReplay ? 200 : 201).json({
      success: true,
      isReplay: result.isReplay,
      data: result.data,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'DEPOSIT_FAILED', message: error.message } });
  }
});

// Withdraw funds
router.post('/withdraw', transactionRateLimiter, async (req: Request, res: Response) => {
  try {
    const validated = withdrawalSchema.parse(req.body);
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    const amountPaise = BigInt(validated.amountPaise);

    const result = await TransactionService.withdraw(
      req.user!.id,
      {
        sourceAccountId: validated.sourceAccountId,
        amountPaise,
        description: validated.description,
        idempotencyKey,
      },
      req.user!.role,
      req.ip || req.socket.remoteAddress,
      req.headers['user-agent']
    );

    res.status(result.isReplay ? 200 : 201).json({
      success: true,
      isReplay: result.isReplay,
      data: result.data,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'WITHDRAWAL_FAILED', message: error.message } });
  }
});

// List transaction history
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const accountId = req.query.accountId as string;

    const result = await TransactionService.getTransactionHistory({
      userId: req.user!.id,
      accountId,
      userRole: req.user!.role,
      page,
      limit,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

// Get single transaction details with double entries
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const transactionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await TransactionService.getTransactionById(transactionId, req.user!.id, req.user!.role);
    res.json({ success: true, data: { transaction: result } });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

export const transactionRouter = router;
