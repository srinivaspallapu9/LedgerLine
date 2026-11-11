import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';

export class AuthService {
  /**
   * Register a new user
   */
  static async register(params: {
    fullName: string;
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const normalizedEmail = params.email.trim().toLowerCase();

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw {
        status: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email address already exists.',
      };
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(params.password, salt);

    const user = await prisma.user.create({
      data: {
        fullName: params.fullName.trim(),
        email: normalizedEmail,
        passwordHash,
        role: UserRole.ACCOUNT_HOLDER,
        isEnabled: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isEnabled: true,
        createdAt: true,
      },
    });

    // Auto-create initial primary INR checking account for new account holders
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const accountNumber = `BV-IN-${randomSuffix}`;

    await prisma.account.create({
      data: {
        accountNumber,
        ownerUserId: user.id,
        accountType: 'CUSTOMER',
        status: 'ACTIVE',
        currency: 'INR',
        balancePaise: BigInt(0),
        version: BigInt(0),
      },
    });

    await AuditService.log({
      actorUserId: user.id,
      eventType: 'AUTH_REGISTER',
      resourceType: 'USER',
      resourceId: user.id,
      outcome: 'SUCCESS',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: { role: user.role, email: user.email },
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, {
      expiresIn: '24h',
    });

    return { user, token };
  }

  /**
   * Authenticate user with email and password
   */
  static async login(params: {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const normalizedEmail = params.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      await AuditService.log({
        actorUserId: null,
        eventType: 'AUTH_LOGIN_FAILED',
        resourceType: 'USER',
        outcome: 'FAILURE',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: { reason: 'USER_NOT_FOUND', email: normalizedEmail },
      });

      throw {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      };
    }

    if (!user.isEnabled) {
      await AuditService.log({
        actorUserId: user.id,
        eventType: 'AUTH_LOGIN_LOCKED',
        resourceType: 'USER',
        resourceId: user.id,
        outcome: 'DENIED',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: { reason: 'ACCOUNT_DISABLED' },
      });

      throw {
        status: 403,
        code: 'ACCOUNT_DISABLED',
        message: 'This account has been disabled. Please contact customer support.',
      };
    }

    const isMatch = await bcrypt.compare(params.password, user.passwordHash);
    if (!isMatch) {
      await AuditService.log({
        actorUserId: user.id,
        eventType: 'AUTH_LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: user.id,
        outcome: 'FAILURE',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: { reason: 'PASSWORD_MISMATCH' },
      });

      throw {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      };
    }

    await AuditService.log({
      actorUserId: user.id,
      eventType: 'AUTH_LOGIN_SUCCESS',
      resourceType: 'USER',
      resourceId: user.id,
      outcome: 'SUCCESS',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, {
      expiresIn: '24h',
    });

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isEnabled: user.isEnabled,
      },
      token,
    };
  }
}
