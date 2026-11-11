import { PrismaClient, UserRole, AccountType, AccountStatus, TransactionType, TransactionStatus, EntryDirection } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://postgres:root@localhost:5432/ledgerline_test?schema=public',
    },
  },
});

async function runPrismaTests() {
  console.log('\n--- Prisma Client Integration Tests ---');

  try {
    // 1. Create User via Prisma Client
    const user = await prisma.user.create({
      data: {
        fullName: 'Prisma Integration User',
        email: 'prisma.user@balancevault.internal',
        passwordHash: await bcrypt.hash('PrismaUserTestPassword', 12),
        role: UserRole.ACCOUNT_HOLDER,
        isEnabled: true,
      },
    });
    console.log(`  ✓ Created User via Prisma Client: ${user.id}`);

    // 2. Create Account via Prisma Client with BigInt balance
    const account = await prisma.account.create({
      data: {
        accountNumber: 'ACC_PRISMA_001',
        ownerUserId: user.id,
        accountType: AccountType.CUSTOMER,
        status: AccountStatus.ACTIVE,
        currency: 'INR',
        balancePaise: BigInt(750000), // 7,500.00 INR
        version: BigInt(0),
      },
    });
    console.log(`  ✓ Created Account via Prisma Client with BigInt paise: ${account.accountNumber} (${account.balancePaise} paise)`);

    // 3. Query Account with relations loaded
    const accountWithUser = await prisma.account.findUnique({
      where: { id: account.id },
      include: { owner: true },
    });
    if (!accountWithUser?.owner || accountWithUser.owner.email !== 'prisma.user@balancevault.internal') {
      throw new Error('Relation query failed');
    }
    console.log(`  ✓ Queried Account with Owner relation loaded: ${accountWithUser.owner.fullName}`);

    // 4. Audit Event recording via Prisma Client
    const auditEvent = await prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        eventType: 'TEST_PRISMA_EVENT',
        resourceType: 'ACCOUNT',
        resourceId: account.id,
        outcome: 'SUCCESS',
        details: { runtime: 'prisma-client-js', version: '6.19.3' },
      },
    });
    console.log(`  ✓ Recorded Audit Event via Prisma Client: ${auditEvent.id}`);

    console.log('  ✓ All Prisma Client tests passed successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

runPrismaTests().catch((err) => {
  console.error('Prisma test failed:', err);
  process.exit(1);
});
