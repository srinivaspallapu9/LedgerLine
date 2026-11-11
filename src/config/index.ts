import dotenv from 'dotenv';
dotenv.config();

const isTest =
  process.env.NODE_ENV === 'test' ||
  process.argv.some((arg) => arg.includes('test'));

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: isTest ? 'test' : process.env.NODE_ENV || 'development',
  databaseUrl:
    isTest && process.env.TEST_DATABASE_URL
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/ledgerline?schema=public',
  testDatabaseUrl: process.env.TEST_DATABASE_URL || 'postgresql://postgres:root@localhost:5432/ledgerline_test?schema=public',
  jwtSecret: process.env.JWT_SECRET || 'balancevault_super_secure_production_secret_key_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  systemReserveAccount: 'SYS_INR_RESERVE_001',
  systemFeesAccount: 'SYS_INR_FEES_001',
};
