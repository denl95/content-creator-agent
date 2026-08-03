import { defineConfig, env } from 'prisma/config';

// Prisma 7 removed `url` from the datasource block: migration and introspection
// commands read it from here, while the client receives a driver adapter at
// construction (see `getDb()` in src/db.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
