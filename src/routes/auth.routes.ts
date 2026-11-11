import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { registerSchema, loginSchema } from '../validation/schemas';
import { authenticateToken } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rate-limiter';

const router = Router();

// Register new user
router.post('/register', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const validated = registerSchema.parse(req.body);
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await AuthService.register({
      ...validated,
      ipAddress: ip,
      userAgent,
    });

    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

// User login
router.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const validated = loginSchema.parse(req.body);
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await AuthService.login({
      ...validated,
      ipAddress: ip,
      userAgent,
    });

    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: error.errors } });
    }
    const status = error.status || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Current user profile
router.get('/me', authenticateToken, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: { user: req.user },
  });
});

export const authRouter = router;
