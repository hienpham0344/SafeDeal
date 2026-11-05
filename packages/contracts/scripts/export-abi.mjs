#!/usr/bin/env node
// Exports minimal ABIs consumed by the Next.js app and the Spring backend.
// Output: abi/<Contract>.json  — regenerate after every contract change (npm run abi:export).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contracts = [
  ["EscrowManager", "contracts/escrow/EscrowManager.sol/EscrowManager.json"],
  ["SubscriptionManager", "contracts/subscription/SubscriptionManager.sol/SubscriptionManager.json"],
  ["DisputeResolver", "contracts/dispute/DisputeResolver.sol/DisputeResolver.json"],
  ["MockPaymentToken", "contracts/token/MockPaymentToken.sol/MockPaymentToken.json"],
];

const outDir = join(root, "abi");
await mkdir(outDir, { recursive: true });

for (const [name, artifactPath] of contracts) {
  const artifact = JSON.parse(await readFile(join(root, "artifacts", artifactPath), "utf8"));
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`exported ${name} (${artifact.abi.length} entries)`);
}
