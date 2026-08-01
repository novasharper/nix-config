// Build-time check that the installed extension tree actually loads.
//
// pi resolves an extension directory through its package.json "pi.extensions"
// manifest and imports the entry with jiti, which transpiles TypeScript and
// resolves the entry's own imports — relative files and bare specifiers alike.
// Nothing is bundled, so a broken relative import or a dependency that cannot
// be resolved from the install prefix would only surface at run time, where a
// failed extension load means pi starts with no shell guard at all.
//
// Usage: bun load-smoke-test.mjs <install-prefix>
import fs from "node:fs";
import path from "node:path";

import { createJiti } from "jiti/static";

const prefix = process.argv[2];
if (!prefix) {
  throw new Error("usage: load-smoke-test.mjs <install-prefix>");
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(prefix, "package.json"), "utf8"),
);
const declared = manifest?.pi?.extensions ?? [];
if (declared.length !== 1) {
  throw new Error(
    `expected exactly one declared extension entry, got ${declared.length}`,
  );
}

const entry = path.resolve(prefix, declared[0]);
if (!fs.existsSync(entry)) {
  throw new Error(`declared entry does not exist: ${entry}`);
}

// Same options pi's loader uses, minus the virtual modules for packages pi
// bundles into its own binary: resolving those from the install prefix is
// exactly what this check needs to prove.
const jiti = createJiti(import.meta.url, { moduleCache: false });
const factory = await jiti.import(entry, { default: true });

if (typeof factory !== "function") {
  throw new Error(
    `extension entry must default-export a factory function, got ${typeof factory}`,
  );
}

console.log(`extension entry loads: ${entry}`);
