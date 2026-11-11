import { UserRole } from '@prisma/client';

export function isAdminPasswordResetRequested(
  args: readonly string[],
  npmArgv?: string,
  npmResetConfig?: string
): boolean {
  if (args.some((arg) => arg === '--reset-existing' || arg === '--reset-existing=true')) {
    return true;
  }

  if (npmResetConfig === 'true') {
    return true;
  }

  if (!npmArgv) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(npmArgv);
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }

    const argv = parsed as { original?: unknown; cooked?: unknown };
    return [argv.original, argv.cooked].some(
      (list) =>
        Array.isArray(list) &&
        list.some((arg) => arg === '--reset-existing' || arg === '--reset-existing=true')
    );
  } catch {
    return false;
  }
}

export interface ProvisionableAdmin {
  id: string;
  email: string;
  role: UserRole;
}

export interface AdminProvisioningStore {
  findUserByEmail(email: string): Promise<ProvisionableAdmin | null>;
  createAdmin(params: {
    fullName: string;
    email: string;
    passwordHash: string;
  }): Promise<ProvisionableAdmin>;
  updateAdminPassword(id: string, passwordHash: string): Promise<ProvisionableAdmin>;
}

export interface AdminProvisioningDependencies {
  store: AdminProvisioningStore;
  hashPassword(password: string): Promise<string>;
  confirmPasswordReset(email: string): Promise<boolean>;
}

export async function provisionAdmin(
  params: {
    fullName: string;
    email: string;
    password: string;
    resetExisting: boolean;
  },
  dependencies: AdminProvisioningDependencies
): Promise<{ action: 'created' | 'unchanged' | 'password-reset'; admin: ProvisionableAdmin }> {
  const email = params.email.trim().toLowerCase();
  const existing = await dependencies.store.findUserByEmail(email);

  if (existing) {
    if (existing.role !== UserRole.ADMIN) {
      throw new Error('The configured email already belongs to a non-admin user; no changes were made.');
    }

    if (!params.resetExisting || !(await dependencies.confirmPasswordReset(email))) {
      return { action: 'unchanged', admin: existing };
    }

    const passwordHash = await dependencies.hashPassword(params.password);
    const admin = await dependencies.store.updateAdminPassword(existing.id, passwordHash);
    return { action: 'password-reset', admin };
  }

  const passwordHash = await dependencies.hashPassword(params.password);
  const admin = await dependencies.store.createAdmin({
    fullName: params.fullName.trim(),
    email,
    passwordHash,
  });
  return { action: 'created', admin };
}
