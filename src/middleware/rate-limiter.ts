import { Request, Response, NextFunction } from 'express';
import { redisService } from '../services/redis.service';

export interface RateLimiterOptions {
  windowSeconds: number;
  maxRequests: number;
  keyPrefix?: string;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowSeconds = 60,
    maxRequests = 100,
    keyPrefix = 'global',
    message = 'Too many requests. Please slow down and try again later.',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // If running in automated tests without explicit rate-limit testing flag, allow high burst
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    // Determine client identifier: IP or Authenticated User ID
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = (req as any).user?.id;
    const clientKey = userId ? `user:${userId}` : `ip:${ip}`;
    const rateLimitKey = `${keyPrefix}:${clientKey}`;

    try {
      const { count, ttl } = await redisService.incrementRateLimit(rateLimitKey, windowSeconds);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
      res.setHeader('X-RateLimit-Reset', ttl);

      if (count > maxRequests) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message,
            retryAfterSeconds: ttl,
          },
        });
      }

      next();
    } catch (error) {
      // Fail open so rate limiter glitch doesn't drop valid banking requests
      console.error('[RateLimiter] Error evaluating rate limit:', error);
      next();
    }
  };
}

// Pre-configured rate limiters
export const authRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 10,
  keyPrefix: 'auth',
  message: 'Too many authentication attempts. Please wait a minute before trying again.',
});

export const apiRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 120,
  keyPrefix: 'api',
});

export const transactionRateLimiter = createRateLimiter({
  windowSeconds: 10,
  maxRequests: 5,
  keyPrefix: 'tx',
  message: 'Too many transaction submissions in a short window. Please wait a moment.',
});

export const recipientVerificationRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 20,
  keyPrefix: 'recipient-verify',
  message: 'Too many recipient verification attempts. Please wait before trying again.',
});
