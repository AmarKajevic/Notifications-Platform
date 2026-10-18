import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },

  datasource: {
    // Not the strict `env("DATABASE_URL")` helper on purpose: that throws as
    // soon as this file is *loaded*, before `prisma generate` even gets to
    // the point of needing a connection (it only reads the schema, never
    // connects). That breaks `prisma generate` anywhere DATABASE_URL isn't
    // set — notably every service's Docker build (correctly .dockerignore's
    // .env, so there's nothing to load it from) and CI. The placeholder is
    // never actually connected to; real commands (migrate, studio, the
    // running services) get the real value from .env / the environment.
    url:
      process.env.DATABASE_URL ??
      'postgresql://user:password@localhost:5432/db',
  },
});
