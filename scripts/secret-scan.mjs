import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith("pnpm-lock.yaml") && !file.startsWith("public/"));

const patterns = [
  { label: "Stripe live secret", expression: /sk_live_[A-Za-z0-9]{16,}/g },
  { label: "Stripe restricted live secret", expression: /rk_live_[A-Za-z0-9]{16,}/g },
  { label: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: "Supabase service-role JWT", expression: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]*service_role[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{20,}/g },
];

const findings = [];
for (const file of files) {
  let source;
  try { source = readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of patterns) {
    if (pattern.expression.test(source)) findings.push(`${file}: ${pattern.label}`);
    pattern.expression.lastIndex = 0;
  }
}

if (findings.length) {
  process.stderr.write(`Potential committed secrets found:\n${findings.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Secret scan passed (${files.length} files checked).\n`);
