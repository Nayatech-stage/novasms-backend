/**
 * PM2 ecosystem config — NovaSMS Backend
 * Usage: pm2 start ecosystem.config.js --env production
 */
module.exports = {
  apps: [
    {
      name: 'novasms-api',
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'novasms-worker',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
        WORKER_ONLY: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        WORKER_ONLY: 'true',
      },
      error_file: 'logs/worker-err.log',
      out_file: 'logs/worker-out.log',
      restart_delay: 5000,
      max_restarts: 5,
    },
  ],
};
