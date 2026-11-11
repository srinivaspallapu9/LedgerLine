import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../src/db/prisma';
import {
  isAdminPasswordResetRequested,
  provisionAdmin,
} from '../src/services/admin-provisioning';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
});

async function confirmPasswordReset(email: string, resetRequested: boolean): Promise<boolean> {
  if (!resetRequested) {
    return false;
  }
  if (!stdin.isTTY) {
    throw new Error('Password reset requires an interactive terminal for confirmation.');
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      `An administrator already exists for ${email}. Type the email to confirm password reset: `
    );
    return answer.trim() === email;
  } finally {
    readline.close();
  }
}

async function main() {
  const resetExisting = isAdminPasswordResetRequested(
    process.argv.slice(2),
    process.env.npm_config_argv,
    process.env.npm_config_reset_existing
  );
  const parsed = credentialsSchema.safeParse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (!parsed.success) {
    throw new Error('Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.');
  }

  const fullName = process.env.ADMIN_NAME?.trim() || 'BalanceVault Administrator';
  const result = await provisionAdmin(
    {
      fullName,
      email: parsed.data.email,
      password: parsed.data.password,
      resetExisting,
    },
    {
      store: {
        async findUserByEmail(email) {
          const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, role: true },
          });
          return user;
        },
        async createAdmin(params) {
          return prisma.user.create({
            data: {
              fullName: params.fullName,
              email: params.email,
              passwordHash: params.passwordHash,
              role: UserRole.ADMIN,
              isEnabled: true,
            },
            select: { id: true, email: true, role: true },
          });
        },
        async updateAdminPassword(id, passwordHash) {
          return prisma.user.update({
            where: { id },
            data: { passwordHash },
            select: { id: true, email: true, role: true },
          });
        },
      },
      hashPassword: (password) => bcrypt.hash(password, 12),
      confirmPasswordReset: (email) => confirmPasswordReset(email, resetExisting),
    }
  );

  if (result.action === 'created') {
    console.log(`Administrator created: ${result.admin.email}`);
  } else if (result.action === 'password-reset') {
    console.log(`Administrator password reset: ${result.admin.email}`);
  } else {
    console.log(`Administrator already exists; no credentials changed: ${result.admin.email}`);
  }
}

main()
  .catch((error) => {
    console.error('Administrator provisioning failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
