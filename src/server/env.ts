import { existsSync } from 'node:fs';

// Imported first by index.ts so values are in place before other modules read them.
if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');

// Printed before the heavier modules load, so a slow first start doesn't look like a hang.
console.log('Starting Go Window... (the first start can take up to 30 seconds)');
