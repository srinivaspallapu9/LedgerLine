import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { authRouter } from './routes/auth.routes';
import { accountRouter } from './routes/account.routes';
import { transactionRouter } from './routes/transaction.routes';
import { adminRouter } from './routes/admin.routes';
import { healthRouter } from './routes/health.routes';
import { apiRateLimiter } from './middleware/rate-limiter';

export const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow localhost or standard dev origins, or same origin
      if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Request correlation ID and trace logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
});

// Global API rate limiter
app.use('/api', apiRateLimiter);

// Routes
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/accounts', accountRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/admin', adminRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist.`,
    },
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || 500;
  console.error(`[Unhandled Error] ${req.method} ${req.path}:`, err);

  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: config.nodeEnv === 'production' ? 'An unexpected error occurred.' : err.message,
      correlationId: req.correlationId,
    },
  });
});

