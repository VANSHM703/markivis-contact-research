import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./db/migrations",
  casing: "snake_case",
  schemaFilter: ["dmi"],
  dbCredentials: {
    url: process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL ?? "postgres://dmi:dmi@localhost:5432/dmi",
  },
});
