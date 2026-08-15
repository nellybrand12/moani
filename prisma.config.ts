// prisma.config.ts — Prisma v7 CLI configuration (not used by PrismaClient at runtime)
// In Prisma v7, all URL configuration moves here from schema.prisma.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Used by the Prisma CLI (migrate dev / migrate deploy / db push)
    // Always point at a direct or session-mode URL — never the transaction pooler
    url: process.env['DIRECT_URL'],
  },
});
