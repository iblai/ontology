// Checks every t('key') usage against messages/en.json.
// Usage: node scripts/check-i18n.mjs   (exits 1 on missing keys)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const messages = JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "components/ui"].some((s) => join(dir, name).includes(s)))
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|mjs)$/.test(name) && !p.endsWith("check-i18n.mjs")) yield p;
  }
}

function has(ns, key) {
  const scope = messages[ns];
  if (!scope) return false;
  return (
    key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), scope) !==
    undefined
  );
}

let missing = 0;
const used = new Set();
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  // const t = useTranslations('ns');  /  const tx = useTranslations('ns');
  const bindings = [...src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)];
  for (const [, varName, ns] of bindings) {
    const calls = [...src.matchAll(new RegExp(`(?<![\\w.])${varName}\\(\\s*'([^']+)'`, "g"))];
    for (const [, key] of calls) {
      used.add(`${ns}.${key.split(".")[0]}`);
      if (!has(ns, key)) {
        console.error(`MISSING ${ns}.${key}  (${file.replace(root + "/", "")})`);
        missing++;
      }
    }
    // dynamic keys like t(`plan_${kind}`) — flag for manual awareness only
    const dynamic = [...src.matchAll(new RegExp(`(?<![\\w.])${varName}\\(\\s*\``, "g"))];
    if (dynamic.length) {
      console.log(
        `note: dynamic keys in ${ns} (${file.replace(root + "/", "")}) — verify enum coverage`,
      );
    }
  }
}

if (missing) {
  console.error(`\n${missing} missing i18n key(s).`);
  process.exit(1);
}
console.log("i18n: all static keys present.");
