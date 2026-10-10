import { existsSync } from 'node:fs';

// Imported first by index.ts so values are in place before other modules read them.
if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
