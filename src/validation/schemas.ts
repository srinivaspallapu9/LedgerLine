import { z } from 'zod';
import { AccountStatus, AccountType, UserRole } from '@prisma/client';

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(120),
  email: z.string().email('Invalid email address').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit'),
}).strict();

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const transferSchema = z.object({
  sourceAccountId: z.string().uuid('Invalid source account UUID'),
  destinationAccountNumber: z.string().regex(/^BV-IN-\d{8}$/i, 'Enter a valid recipient account number'),
  amountPaise: z.union([
    z.number().int().positive().safe(),
    z.string().refine(
      (amount) => /^[1-9]\d*$/.test(amount) && BigInt(amount) <= 9223372036854775807n,
      'Amount must be a positive integer in paise within the supported range'
    ),
  ]),
  description: z.string().max(250).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
}).strict();

export const recipientVerificationSchema = z.object({
  accountNumber: z.string().regex(/^BV-IN-\d{8}$/i, 'Enter a valid recipient account number'),
});

export const depositSchema = z.object({
  destinationAccountId: z.string().uuid('Invalid destination account UUID'),
  amountPaise: z.union([z.number().positive(), z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer in paise')]),
  description: z.string().max(250).optional(),
});

export const withdrawalSchema = z.object({
  sourceAccountId: z.string().uuid('Invalid source account UUID'),
  amountPaise: z.union([z.number().positive(), z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer in paise')]),
  description: z.string().max(250).optional(),
});

export const createAccountSchema = z.object({
  userId: z.string().uuid().optional(),
  accountType: z.nativeEnum(AccountType).optional(),
});

export const updateAccountStatusSchema = z.object({
  status: z.nativeEnum(AccountStatus),
  reason: z.string().max(250).optional(),
});

export const updateUserStatusSchema = z.object({
  isEnabled: z.boolean(),
  reason: z.string().max(250).optional(),
});

export const updateUserRoleSchema = z.object({
  role: z.nativeEnum(UserRole),
});
