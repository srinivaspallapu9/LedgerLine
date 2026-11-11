import { PrismaClient, AccountType, AccountStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial system accounts...');

  // Internal System Accounts (strictly ownerUserId = null)
  const systemAccounts = [
    {
      accountNumber: 'SYS_INR_RESERVE_001',
      accountType: AccountType.SYSTEM,
      status: AccountStatus.ACTIVE,
      currency: 'INR',
      balancePaise: BigInt(0),
    },
    {
      accountNumber: 'SYS_INR_FEES_001',
      accountType: AccountType.SYSTEM,
      status: AccountStatus.ACTIVE,
      currency: 'INR',
      balancePaise: BigInt(0),
    },
  ];

  for (const sysAcc of systemAccounts) {
    const acc = await prisma.account.upsert({
      where: { accountNumber: sysAcc.accountNumber },
      update: {},
      create: {
        accountNumber: sysAcc.accountNumber,
        accountType: sysAcc.accountType,
        status: sysAcc.status,
        currency: sysAcc.currency,
        balancePaise: sysAcc.balancePaise,
        ownerUserId: null,
      },
    });
    console.log(`System account ready: ${acc.accountNumber} (${acc.id})`);
  }

  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
