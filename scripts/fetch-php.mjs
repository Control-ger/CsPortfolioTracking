// Downloads a fully-static PHP CLI runtime (and a CA bundle) and places it under
// resources/php/<platform>/ so electron-builder can bundle it into the desktop
// app. This lets the PHP sidecar run without any system PHP installed, on both
// Linux and Windows.
//
// Sources:
//   - Linux / macOS: static-php-cli "common" builds (https://static-php.dev)
//   - Windows:        static-php-cli "spc-max" build (single static php.exe)
// All three ship curl, openssl, mbstring, sqlite3 and pdo_sqlite compiled in.
//
// A Mozilla CA bundle (cacert.pem) is fetched alongside the binary. A static
// build has no system trust store to fall back on (especially on Windows), so
// sidecar.js points curl/openssl at this bundle at spawn time.
//
// Usage:
//   node scripts/fetch-php.mjs           # download if missing
//   node scripts/fetch-php.mjs --force   # re-download even if present
//
// The binaries are intentionally NOT committed to git (see .gitignore); they are
// fetched at build time by the build / build:linux scripts.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CACERT_URL = "https://curl.se/ca/cacert.pem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const force = process.argv.includes("--force");

// Map Node's platform/arch to a static-php-cli artifact and our layout.
// static-php-cli's Windows builds top out a patch or two behind linux/macOS,
// so the version is pinned per target rather than shared.
function resolveTarget() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";

  if (process.platform === "linux") {
    const version = "8.3.32";
    return {
      platformDir: "linux",
      binName: "php",
      url: `https://dl.static-php.dev/static-php-cli/common/php-${version}-cli-linux-${arch}.tar.gz`,
      version,
    };
  }

  if (process.platform === "darwin") {
    const version = "8.3.32";
    return {
      platformDir: "mac",
      binName: "php",
      url: `https://dl.static-php.dev/static-php-cli/common/php-${version}-cli-macos-${arch}.tar.gz`,
      version,
    };
  }

  if (process.platform === "win32") {
    const version = "8.3.30";
    return {
      platformDir: "win",
      binName: "php.exe",
      url: `https://dl.static-php.dev/static-php-cli/windows/spc-max/php-${version}-cli-win.zip`,
      version,
    };
  }

  return null;
}

async function download(url) {
  const response = await fetch(url); // follows CDN redirects automatically
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
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
  const caBundle = path.join(destDir, "cacert.pem");

  if (fs.existsSync(destBin) && fs.existsSync(caBundle) && !force) {
    console.log(`[fetch-php] already present: ${destBin} (use --force to redownload)`);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  // --- PHP binary ---
  console.log(`[fetch-php] downloading PHP ${target.version}: ${target.url}`);
  const archiveBuf = await download(target.url);
  const archiveName = path.basename(new URL(target.url).pathname);
  const tmpArchive = path.join(os.tmpdir(), archiveName);
  fs.writeFileSync(tmpArchive, archiveBuf);
  console.log(`[fetch-php] downloaded ${(archiveBuf.length / 1048576).toFixed(1)} MB`);

  // Each archive contains a single php binary at its root. `tar` handles both
  // .tar.gz (GNU/bsd tar) and .zip (bsdtar on Windows/macOS).
  execFileSync("tar", ["-xf", tmpArchive, "-C", destDir], { stdio: "inherit" });
  fs.rmSync(tmpArchive, { force: true });

  if (process.platform !== "win32") {
    fs.chmodSync(destBin, 0o755);
  }

  // --- CA bundle ---
  console.log(`[fetch-php] downloading CA bundle: ${CACERT_URL}`);
  fs.writeFileSync(caBundle, await download(CACERT_URL));

  // --- sanity check (skip on Windows: cannot run php.exe from another OS) ---
  if (process.platform !== "win32") {
    const version = execFileSync(destBin, ["-v"], { encoding: "utf8" }).split("\n")[0];
    console.log(`[fetch-php] ${version}`);
  }
  console.log(`[fetch-php] ready: ${destBin}`);
  console.log(`[fetch-php] ca bundle: ${caBundle}`);
}

main().catch((error) => {
  console.error(`[fetch-php] ${error.message}`);
  process.exit(1);
});
