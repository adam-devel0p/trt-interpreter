// Shared bootstrap for tsx scripts: load .env.local then .env (Next.js does this for the app).
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
