/* eslint-disable */

import { app } from "electron";
import { spawn } from "child_process";
import { createServer as netCreateServer } from "net";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Shared mutable state (also consumed by main/index.js) ─────────
export let phpSidecar = null;
export let sidecarSecret = "";
export let sidecarRequestHeaderBridgeInstalled = false;

export function setSidecarProcess(proc) {
  phpSidecar = proc;
}

export function setSidecarSecret(secret) {
  sidecarSecret = secret;
}

export function setSidecarHeaderBridgeInstalled(val) {
  sidecarRequestHeaderBridgeInstalled = val;
}

// ── Port and URL resolution ───────────────────────────────────────
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

let cachedFreePort = null;

function resolveRuntimePath(...segments) {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", ...segments),
    path.join(process.resourcesPath, ...segments),
    path.join(appPath, ...segments),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function isAsarVirtualPath(targetPath) {
  const normalized = String(targetPath || "").replace(/\//g, "\\").toLowerCase();
  return normalized.includes("\\app.asar\\");
}

function readDotEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return {};
  }

  const values = {};
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function resolvePhpBinary() {
  const explicit = String(process.env.PHP_BINARY || "").trim();
  if (explicit && fsSync.existsSync(explicit)) {
    return explicit;
  }

  const candidates = [
    "C:\\tools\\php85\\php.exe",
    resolveRuntimePath("php", "php.exe"),
    path.join(process.resourcesPath || "", "php", "php.exe"),
    "php",
  ];

  for (const candidate of candidates) {
    if (candidate === "php") {
      return candidate;
    }
    if (candidate && fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return "php";
}

export function findFreePort() {
  if (cachedFreePort) {
    return Promise.resolve(cachedFreePort);
  }
  return new Promise((resolve, reject) => {
    const server = netCreateServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => {
        cachedFreePort = port;
        resolve(port);
      });
    });
  });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSidecarAuthHeaders() {
  if (!sidecarSecret) {
    return {};
  }
  return {
    "X-Desktop-Sidecar-Secret": sidecarSecret,
  };
}

// ── Request header bridge ─────────────────────────────────────────

export async function installSidecarRequestHeaderBridge() {
  if (sidecarRequestHeaderBridgeInstalled) {
    return;
  }

  const { session } = await import("electron");

  const filter = {
    urls: [
      "http://127.0.0.1:*/*",
      "http://localhost:*/*",
    ],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders };

    if (sidecarSecret) {
      headers["X-Desktop-Sidecar-Secret"] = sidecarSecret;
    }

    callback({ requestHeaders: headers });
  });

  sidecarRequestHeaderBridgeInstalled = true;
  console.log("[sidecar] request header bridge installed");
}

// ── Wait for sidecar readiness ────────────────────────────────────

export async function waitForSidecarReady(sidecarUrl, timeoutMs = 15000) {
  const startTime = Date.now();
  let lastError = null;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${sidecarUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(3000),
        headers: getSidecarAuthHeaders(),
      });
      if (response.ok) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw new Error(
    `Sidecar did not become ready within ${timeoutMs}ms. Last error: ${lastError?.message || "unknown"}`,
  );
}

// ── Start / Stop / Restart sidecar ────────────────────────────────

export async function startPhpSidecar() {
  if (phpSidecar) {
    console.log("[sidecar] already running");
    return;
  }

  const phpBinary = resolvePhpBinary();
  const port = await findFreePort();
  const secret = crypto.randomBytes(32).toString("hex");
  sidecarSecret = secret;

  const desktopDir = path.resolve(__dirname, "..");
  const backendEntry = path.resolve(desktopDir, "backend", "desktop", "index.php");
  const phpIni = path.resolve(desktopDir, "..", "..", "backend", "desktop", "php.ini");

  if (!fsSync.existsSync(backendEntry)) {
    throw new Error(`Backend entry not found: ${backendEntry}`);
  }

  const args = [
    "-d",
    `error_log=${path.join(app.getPath("userData"), "logs", "php-sidecar-errors.log")}`,
  ];

  if (fsSync.existsSync(phpIni)) {
    args.push("-c", phpIni);
  }

  args.push(
    "-S",
    `127.0.0.1:${port}`,
    "-t",
    path.dirname(backendEntry),
    backendEntry,
  );

  const env = buildSidecarEnv(port, secret);

  console.log(`[sidecar] starting PHP built-in server on 127.0.0.1:${port}`);
  console.log(`[sidecar] php binary: ${phpBinary}`);

  const proc = spawn(phpBinary, args, {
    cwd: path.dirname(backendEntry),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  phpSidecar = proc;

  let startupData = "";
  const onData = (chunk) => {
    startupData += String(chunk || "");
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);

  proc.on("error", (error) => {
    console.error("[sidecar] spawn error:", error);
    phpSidecar = null;
  });

  proc.on("exit", (code, signal) => {
    console.log(`[sidecar] exited (code=${code}, signal=${signal})`);
    if (phpSidecar === proc) {
      phpSidecar = null;
    }
  });

  const sidecarUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForSidecarReady(sidecarUrl);
    console.log("[sidecar] ready:", sidecarUrl);
    return { url: sidecarUrl, port, secret };
  } catch (error) {
    console.error("[sidecar] startup failed:", startupData.slice(0, 2000));
    stopPhpSidecar();
    throw error;
  }
}

export function stopPhpSidecar() {
  if (!phpSidecar) {
    return;
  }

  try {
    if (!phpSidecar.killed) {
      phpSidecar.kill("SIGTERM");
      setTimeout(() => {
        if (phpSidecar && !phpSidecar.killed) {
          try {
            phpSidecar.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, 3000);
    }
  } catch (error) {
    console.warn("[sidecar] error stopping php sidecar:", error);
  }

  phpSidecar = null;
  cachedFreePort = null;
}

export async function restartPhpSidecar() {
  stopPhpSidecar();
  await delay(500);
  return await startPhpSidecar();
}

export async function ensurePhpSidecarForRenderer() {
  if (phpSidecar) {
    return {
      url: `http://127.0.0.1:${cachedFreePort}`,
      port: cachedFreePort,
      secret: sidecarSecret,
    };
  }

  const result = await startPhpSidecar();
  return result;
}

// ── Environment builder ───────────────────────────────────────────

async function buildSidecarEnv(port, secret) {
  const env = { ...process.env };

  // Clear server-mode env to prevent sidecar from touching MySQL
  delete env.MYSQL_HOST;
  delete env.MYSQL_PORT;
  delete env.MYSQL_DATABASE;
  delete env.MYSQL_USER;
  delete env.MYSQL_PASSWORD;

  // Force SQLite-only
  env.APP_DATABASE_DRIVER = "sqlite";
  env.SIDECAR_PORT = String(port);
  env.SIDECAR_SECRET = secret;
  env.DESKTOP_SIDECAR_MODE = "1";
  env.DESKTOP_ENTRY_POINT = "1";

  // App paths for the PHP sidecar
  env.DESKTOP_USER_DATA_PATH = app.getPath("userData");

  // Attempt to pass API keys from secret vault if already unlocked
  try {
    const { getStoredCsFloatApiKey, getStoredSkinBaronApiKey, getStoredSkinBaronSessionCookie } = await import("./secret-vault.js");
    const csFloatApiKey = getStoredCsFloatApiKey();
    if (csFloatApiKey) {
      env.CSFLOAT_API_KEY = csFloatApiKey;
    }
    const skinBaronApiKey = getStoredSkinBaronApiKey();
    if (skinBaronApiKey) {
      env.SKINBARON_API_KEY = skinBaronApiKey;
    }
    const skinBaronSessionCookie = getStoredSkinBaronSessionCookie();
    if (skinBaronSessionCookie) {
      env.SKINBARON_SESSION_COOKIE = skinBaronSessionCookie;
    }
  } catch {
    // Vault locked or not configured - sidecar will read from files
  }

  // Encryption key for session token storage
  try {
    const { getOrCreateEncryptionKey } = await import("./secret-vault.js");
    const encryptionKey = getOrCreateEncryptionKey();
    if (encryptionKey) {
      env.DESKTOP_ENCRYPTION_KEY = encryptionKey;
    }
  } catch {
    // safeStorage unavailable
  }

  return env;
}

// Re-export for use from index.js
export { buildSidecarEnv, resolvePhpBinary, resolveRuntimePath, isAsarVirtualPath, readDotEnvFile };
