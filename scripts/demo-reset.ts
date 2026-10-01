/**
 * npm run demo:reset: drops the schema, migrates from scratch, loads the seed workspaces, then in
 * mock mode stages the demo (src/db/seed/demo.ts) so every screen opens populated (BRD 21).
 */
import { getDataMode } from "@/config/env";
import { closeDatabase } from "@/db/client";
import { loadSeed } from "@/db/seed";
import { stageDemo } from "@/db/seed/demo";
import { resetDatabase } from "./migrate";

async function main() {
  await resetDatabase();
  const bundle = await loadSeed();
  for (const w of bundle.workspaces) {
    console.log(`${w.workspace.name}: ${w.companies.length} companies, ${w.persons.length} people, ${w.roles.length} roles, ${w.interactions.length} interactions`);
  }
  if (getDataMode() === "mock" && !process.argv.includes("--seed-only")) {
    await stageDemo(bundle.workspaces[0]!.workspace.id, (line) => console.log(`Demo Search Partners. ${line}`));
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
