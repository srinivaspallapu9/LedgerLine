import assert from 'node:assert/strict';
import { UserRole } from '@prisma/client';
import { registerSchema } from '../src/validation/schemas';
import {
  isAdminPasswordResetRequested,
  AdminProvisioningStore,
  ProvisionableAdmin,
  provisionAdmin,
} from '../src/services/admin-provisioning';

function createStore(existing: ProvisionableAdmin | null = null) {
  const calls: string[] = [];
  const store: AdminProvisioningStore = {
    async findUserByEmail(email) {
      calls.push(`find:${email}`);
      return existing;
    },
    async createAdmin(params) {
      calls.push(`create:${params.email}:${params.passwordHash}`);
      return { id: 'new-id', email: params.email, role: UserRole.ADMIN };
    },
    async updateAdminPassword(id, passwordHash) {
      calls.push(`update:${id}:${passwordHash}`);
      return { id, email: existing!.email, role: UserRole.ADMIN };
    },
  };
  return { store, calls };
}

async function main() {
  assert.equal(
    isAdminPasswordResetRequested(['--reset-existing']),
    true,
    'Direct CLI arguments must enable password reset mode',
  );
  assert.equal(
    isAdminPasswordResetRequested([
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\project\\node_modules\\tsx\\dist\\cli.mjs',
      'scripts/provision-admin.ts',
      '--reset-existing',
    ]),
    true,
    'Arguments forwarded by npm through tsx must enable password reset mode',
  );
  assert.equal(
    isAdminPasswordResetRequested([], JSON.stringify({
      original: ['run', 'admin:provision', '--', '--reset-existing'],
    })),
    true,
    'Npm original arguments must enable password reset mode when the shell omits them',
  );
  assert.equal(
    isAdminPasswordResetRequested([], undefined, 'true'),
    true,
    'Npm config flag must enable password reset mode',
  );
  assert.equal(isAdminPasswordResetRequested([]), false);
  if (process.env.VERIFY_RESET_FLAG_FORWARDING === '1') {
    assert.equal(
      isAdminPasswordResetRequested(
        process.argv.slice(2),
        process.env.npm_config_argv,
        process.env.npm_config_reset_existing
      ),
      true,
      'The reset flag must survive the actual npm-to-tsx script invocation',
    );
    console.log('Npm-to-tsx reset argument forwarding verified.');
  }

  const hashedPasswords: string[] = [];
  const common = {
    hashPassword: async (password: string) => {
      hashedPasswords.push(password);
      return `test-hash-${hashedPasswords.length}`;
    },
    confirmPasswordReset: async () => true,
  };

  {
    const { store, calls } = createStore();
    const result = await provisionAdmin(
      {
        fullName: '  Local Admin  ',
        email: '  ADMIN@example.com ',
        password: 'LocalAdminPass123',
        resetExisting: false,
      },
      { ...common, store }
    );
    assert.equal(result.action, 'created');
    assert.equal(result.admin.role, UserRole.ADMIN);
    assert.deepEqual(calls, [
      'find:admin@example.com',
      'create:admin@example.com:test-hash-1',
    ]);
  }

  {
    const existing = { id: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN };
    const { store, calls } = createStore(existing);
    const result = await provisionAdmin(
      {
        fullName: 'Admin',
        email: existing.email,
        password: 'ReplacementPass123',
        resetExisting: false,
      },
      {
        ...common,
        store,
        confirmPasswordReset: async () => {
          throw new Error('Must not request reset confirmation without the reset flag');
        },
      }
    );
    assert.equal(result.action, 'unchanged');
    assert.deepEqual(calls, ['find:admin@example.com']);
  }

  {
    const existing = { id: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN };
    const { store, calls } = createStore(existing);
    const result = await provisionAdmin(
      {
        fullName: 'Admin',
        email: existing.email,
        password: 'ReplacementPass123',
        resetExisting: true,
      },
      {
        ...common,
        store,
        confirmPasswordReset: async () => false,
      }
    );
    assert.equal(result.action, 'unchanged');
    assert.deepEqual(calls, ['find:admin@example.com']);
  }

  {
    const existing = { id: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN };
    const { store, calls } = createStore(existing);
    const result = await provisionAdmin(
      {
        fullName: 'Admin',
        email: existing.email,
        password: 'ReplacementPass123',
        resetExisting: true,
      },
      { ...common, store }
    );
    assert.equal(result.action, 'password-reset');
    assert.deepEqual(calls, [
      'find:admin@example.com',
      'update:admin-id:test-hash-2',
    ]);
  }

  {
    const { store, calls } = createStore({
      id: 'customer-id',
      email: 'admin@example.com',
      role: UserRole.ACCOUNT_HOLDER,
    });
    await assert.rejects(
      provisionAdmin(
        {
          fullName: 'Admin',
          email: 'admin@example.com',
          password: 'LocalAdminPass123',
          resetExisting: true,
        },
        { ...common, store }
      ),
      /non-admin user; no changes were made/
    );
    assert.deepEqual(calls, ['find:admin@example.com']);
  }

  const validRegistration = {
    fullName: 'New Customer',
    email: 'customer@example.com',
    password: 'CustomerPass123',
  };
  assert.equal(registerSchema.parse(validRegistration).email, validRegistration.email);
  assert.equal(
    registerSchema.safeParse({ ...validRegistration, role: UserRole.ADMIN }).success,
    false,
    'Public registration must reject an ADMIN role',
  );
  assert.equal(
    registerSchema.safeParse({ ...validRegistration, role: UserRole.AUDITOR }).success,
    false,
    'Public registration must not allow self-assigned roles',
  );

  console.log('Admin provisioning and registration authorization tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
