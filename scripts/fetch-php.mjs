// Downloads a fully-static PHP CLI runtime and places it under
// resources/php/<platform>/ so electron-builder can bundle it into the desktop
// app. This lets the PHP sidecar run without any system PHP installed.
//
// Source: static-php-cli "common" prebuilt binaries (https://static-php.dev).
// The common linux-x86_64 build has curl, openssl, mbstring, sqlite3 and
// pdo_sqlite compiled in statically — exactly what backend/desktop needs.
//
// Usage:
//   node scripts/fetch-php.mjs           # download if missing
//   node scripts/fetch-php.mjs --force   # re-download even if present
//
// The binary is intentionally NOT committed to git (see .gitignore); it is
// fetched at build time by the build:linux script.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PHP_VERSION = "8.3.32";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const force = process.argv.includes("--force");

// Map Node's platform/arch to a static-php-cli artifact and our layout.
function resolveTarget() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";

  if (process.platform === "linux") {
    return {
      platformDir: "linux",
      binName: "php",
      artifact: `php-${PHP_VERSION}-cli-linux-${arch}.tar.gz`,
    };
  }

  if (process.platform === "darwin") {
    return {
      platformDir: "mac",
      binName: "php",
      artifact: `php-${PHP_VERSION}-cli-macos-${arch}.tar.gz`,
    };
  }

  // Windows uses a system/bundled php.exe via a separate path; nothing to do.
  return null;
}

async function main() {
  const target = resolveTarget();
  if (!target) {
    console.log(
      `[fetch-php] platform '${process.platform}' not handled by this script; skipping.`,
    );
    return;
  }

  const destDir = path.join(projectRoot, "resources", "php", target.platformDir);
  const destBin = path.join(destDir, target.binName);

  if (fs.existsSync(destBin) && !force) {
    console.log(`[fetch-php] already present: ${destBin} (use --force to redownload)`);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  const url = `https://dl.static-php.dev/static-php-cli/common/${target.artifact}`;
  console.log(`[fetch-php] downloading PHP ${PHP_VERSION}: ${url}`);

  // fetch() follows the CDN redirect (302 -> object storage) automatically.
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const tmpArchive = path.join(os.tmpdir(), `${target.artifact}`);
  fs.writeFileSync(tmpArchive, buffer);
  console.log(`[fetch-php] downloaded ${(buffer.length / 1048576).toFixed(1)} MB`);

  // The tarball contains a single `php` binary at its root.
  execFileSync("tar", ["-xzf", tmpArchive, "-C", destDir], { stdio: "inherit" });
  fs.rmSync(tmpArchive, { force: true });

  fs.chmodSync(destBin, 0o755);

  // Sanity check: the binary must run and report a version.
  const version = execFileSync(destBin, ["-v"], { encoding: "utf8" }).split("\n")[0];
  console.log(`[fetch-php] ready: ${destBin}`);
  console.log(`[fetch-php] ${version}`);
}

main().catch((error) => {
  console.error(`[fetch-php] ${error.message}`);
  process.exit(1);
});
