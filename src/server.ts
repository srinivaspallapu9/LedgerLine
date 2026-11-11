import { app } from './app';
import { config } from './config';

const server = app.listen(config.port, () => {
  console.log('====================================================');
  console.log(`BalanceVault Banking API Server Running`);
  console.log(`Port: ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Health endpoint: http://localhost:${config.port}/api/health`);
  console.log(`Readiness endpoint: http://localhost:${config.port}/api/ready`);
  console.log('====================================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing HTTP server gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Closing HTTP server gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

