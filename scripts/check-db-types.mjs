import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const generated = execFileSync("supabase", ["gen", "types", "typescript", "--local", "--schema", "api,domain"], { encoding: "utf8" }).replace(/\r\n/g, "\n").trim();
const checkedIn = readFileSync("src/lib/database.types.ts", "utf8").replace(/\r\n/g, "\n").trim();
if (generated !== checkedIn) {
  process.stderr.write("Generated Supabase types differ from src/lib/database.types.ts. Run pnpm db:types and commit the result.\n");
  process.exit(1);
}
process.stdout.write("Generated Supabase types match the checked-in file.\n");
