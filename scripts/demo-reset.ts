/** npm run demo:reset: drops the schema, migrates from scratch, and loads the seed workspaces (BRD 21). */
import { closeDatabase } from "@/db/client";
import { loadSeed } from "@/db/seed";
import { resetDatabase } from "./migrate";

async function main() {
  await resetDatabase();
  const bundle = await loadSeed();
  for (const w of bundle.workspaces) {
    console.log(`${w.workspace.name}: ${w.companies.length} companies, ${w.persons.length} people, ${w.roles.length} roles, ${w.interactions.length} interactions`);
  }
  console.log("Sign in at /intelligence/sign-in as any of:");
  for (const u of bundle.users) console.log(`  ${u.name} <${u.email}>`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
