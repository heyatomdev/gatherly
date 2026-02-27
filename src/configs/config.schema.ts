import * as process from 'node:process';

export default () => ({
  // Environment
  environment: process.env.NODE_ENV || 'development',

  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  // Database
  database: process.env.DATABASE_URL,

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
  },
});
