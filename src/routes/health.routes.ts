import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { redisService } from '../services/redis.service';

const router = Router();

// Liveness probe
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    service: 'BalanceVault Core Financial API',
    version: '1.0.0',
    memoryUsage: process.memoryUsage(),
  });
});

// Readiness probe
router.get('/ready', async (req: Request, res: Response) => {
  const checks: Record<string, any> = {
    database: 'unknown',
    redis: redisService.isConnected ? 'connected' : 'memory_fallback',
  };

  try {
    // Probe PostgreSQL database connection
    await prisma.$queryRaw`SELECT 1;`;
    checks.database = 'connected';
  } catch (error: any) {
    checks.database = 'error';
    checks.databaseError = error.message;
  }

  const isHealthy = checks.database === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    ready: isHealthy,
    timestamp: new Date().toISOString(),
    checks,
  });
});

export const healthRouter = router;

