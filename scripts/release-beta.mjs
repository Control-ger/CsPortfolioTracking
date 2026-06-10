#!/usr/bin/env node
/**
 * release-beta.mjs
 *
 * Creates a beta tag and pushes it to trigger the Beta Release workflow.
 * Usage: node scripts/release-beta.mjs [branch] [suffix]
 *
 * Defaults:
 *   branch: current branch
 *   suffix: branch name (sanitized)
 *
 * Examples:
 *   node scripts/release-beta.mjs                              → beta-v0.2.26-refactor/codebase-decomposition
 *   node scripts/release-beta.mjs refactor/codebase-decomposition  → beta-v0.2.26-refactor-codebase-decomposition
 *   node scripts/release-beta.mjs . fix-buyorders              → beta-v0.2.26-fix-buyorders
 */
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const version = pkg.version;

const args = process.argv.slice(2);
const branchArg = args[0];
const suffixArg = args[1];

// Determine branch
let branch;
if (branchArg && branchArg !== ".") {
  branch = branchArg;
} else {
  branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
}

// Determine suffix
let suffix;
if (suffixArg) {
  suffix = suffixArg;
} else {
  // Use branch name, sanitize for git tag
  suffix = branch.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

const tagName = `beta-v${version}-${suffix}`;

console.log(`\n🔖 Creating beta tag: ${tagName}`);
console.log(`   Branch: ${branch}\n`);

// Checkout branch if specified
if (branchArg && branchArg !== ".") {
  console.log(`   → git checkout ${branch}`);
  execSync(`git checkout ${branch}`, { stdio: "inherit", cwd: root });
}

// Read current branch to verify
const currentBranch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
console.log(`   → on branch: ${currentBranch}`);

// Create tag
execSync(`git tag ${tagName}`, { stdio: "inherit", cwd: root });

// Push tag
console.log(`   → git push origin ${tagName}`);
execSync(`git push origin ${tagName}`, { stdio: "inherit", cwd: root });

console.log(`\n✅ Beta release gestartet: ${tagName}`);
console.log(`   → GitHub: https://github.com/Control-ger/CsPortfolioTracking/actions/workflows/beta-release.yml`);
console.log(`   → Docker: ghcr.io/control-ger/csportfoliotracking-web:${tagName}\n`);
