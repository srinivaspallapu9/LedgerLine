import { spawn } from 'child_process';

async function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} ${args.join(' ')} failed with code ${code}`));
    });
  });
}

async function main() {
  console.log('\n>>> STAGE 1: Running Core PostgreSQL Engine Invariant Tests (36 tests) <<<\n');
  await runCommand('npx', ['tsx', 'tests/run-all-tests.ts']);

  console.log('\n>>> STAGE 2: Running API End-to-End, Concurrency & Idempotency Tests (11 tests) <<<\n');
  await runCommand('npx', ['tsx', 'tests/api-integration.test.ts']);

  console.log('\n🎉 ALL 47 TEST CASES COMPLETED AND PASSED WITH ZERO FAILURES! 🎉\n');
}

main().catch((err) => {
  console.error('\n❌ Test suite failed:', err.message);
  process.exit(1);
});

