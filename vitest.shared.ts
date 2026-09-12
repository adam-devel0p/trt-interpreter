import path from 'node:path';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

export const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  'server-only': path.resolve(import.meta.dirname, 'src/__tests__/stubs/server-only.ts'),
};
