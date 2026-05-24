#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";

function safeExec(command) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function parseArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return "";
  }
  return String(process.argv[index + 1] || "").trim();
}

const baseArgValue = parseArg("--base");
const headArgValue = parseArg("--head") || "HEAD";

function isNullSha(value) {
  return /^[0]+$/.test(String(value || "").trim());
}

function buildScopedDiffCommand(path) {
  const safePath = String(path || "").trim();
  if (!safePath) {
    return "";
  }

  if (baseArgValue && !isNullSha(baseArgValue)) {
    return `git diff --unified=0 ${baseArgValue}...${headArgValue} -- ${safePath}`;
  }

  const githubBaseRef = String(process.env.GITHUB_BASE_REF || "").trim();
  if (githubBaseRef) {
    const remoteBase = `origin/${githubBaseRef}`;
    const remoteExists = safeExec(`git rev-parse --verify ${remoteBase}`);
    if (remoteExists) {
      return `git diff --unified=0 ${remoteBase}...${headArgValue} -- ${safePath}`;
    }
  }

  const staged = safeExec(`git diff --unified=0 --cached -- ${safePath}`);
  if (staged) {
    return `git diff --unified=0 --cached -- ${safePath}`;
  }

  const workingTree = safeExec(`git diff --unified=0 HEAD -- ${safePath}`);
  if (workingTree) {
    return `git diff --unified=0 HEAD -- ${safePath}`;
  }

  const prevCommit = safeExec("git rev-parse --verify HEAD~1");
  if (prevCommit) {
    return `git diff --unified=0 HEAD~1..HEAD -- ${safePath}`;
  }

  return "";
}

function isVersionOnlyJsonDiff(path) {
  const diffCommand = buildScopedDiffCommand(path);
  if (!diffCommand) {
    return false;
  }

  const diff = safeExec(diffCommand);
  if (!diff) {
    return false;
  }

  const changedLines = diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .filter((line) => !line.startsWith("+++ ") && !line.startsWith("--- "));

  if (changedLines.length === 0) {
    return false;
  }

  return changedLines.every((line) => line.includes("\"version\""));
}

function resolveDiffCommand() {
  const baseArg = baseArgValue;
  const headArg = headArgValue;

  if (baseArg && !isNullSha(baseArg)) {
    return `git diff --name-status ${baseArg}...${headArg}`;
  }

  const githubBaseRef = String(process.env.GITHUB_BASE_REF || "").trim();
  if (githubBaseRef) {
    const remoteBase = `origin/${githubBaseRef}`;
    const remoteExists = safeExec(`git rev-parse --verify ${remoteBase}`);
    if (remoteExists) {
      return `git diff --name-status ${remoteBase}...${headArg}`;
    }
  }

  const staged = safeExec("git diff --name-status --cached");
  if (staged) {
    return "git diff --name-status --cached";
  }

  const workingTree = safeExec("git diff --name-status HEAD");
  if (workingTree) {
    return "git diff --name-status HEAD";
  }

  const prevCommit = safeExec("git rev-parse --verify HEAD~1");
  if (prevCommit) {
    return "git diff --name-status HEAD~1..HEAD";
  }

  return "";
}

function parseNameStatus(output) {
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const statusToken = String(parts[0] || "");
      const status = statusToken.charAt(0);

      if (status === "R" || status === "C") {
        return {
          status,
          oldPath: String(parts[1] || ""),
          path: String(parts[2] || ""),
          raw: line,
        };
      }

      return {
        status,
        oldPath: "",
        path: String(parts[1] || ""),
        raw: line,
      };
    })
    .filter((entry) => entry.path);
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

function listUntrackedEntries() {
  const output = safeExec("git ls-files --others --exclude-standard");
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => ({
      status: "A",
      oldPath: "",
      path,
      raw: `A\t${path}`,
    }));
}

function parseActiveDocsTablePaths(agentsContent) {
  const text = String(agentsContent || "");
  const headerIndex = text.indexOf("## Aktive Docs");
  if (headerIndex < 0) {
    return new Set();
  }

  const subsection = text.slice(headerIndex);
  const rows = subsection.split(/\r?\n/);
  const docPaths = new Set();

  for (const row of rows) {
    if (!row.trim().startsWith("|")) {
      if (docPaths.size > 0) {
        break;
      }
      continue;
    }

    const match = row.match(/`([^`]+\.md)`/i);
    if (match && match[1]) {
      docPaths.add(match[1]);
    }
  }

  return docPaths;
}

const diffCommand = resolveDiffCommand();
if (!diffCommand) {
  console.log("[docs-guard] No diff scope available. Skipping.");
  process.exit(0);
}

const rawDiff = safeExec(diffCommand);
const trackedEntries = parseNameStatus(rawDiff);
const trackedSet = new Set(trackedEntries.map((entry) => entry.path));
const untrackedEntries = listUntrackedEntries().filter((entry) => !trackedSet.has(entry.path));
const entries = [...trackedEntries, ...untrackedEntries];
if (entries.length === 0) {
  console.log("[docs-guard] No changed files detected. Skipping.");
  process.exit(0);
}

const changedPaths = [...new Set(entries.map((entry) => entry.path))];
const packageJsonVersionOnly = changedPaths.includes("package.json") && isVersionOnlyJsonDiff("package.json");
const packageLockVersionOnly =
  changedPaths.includes("package-lock.json") && isVersionOnlyJsonDiff("package-lock.json");

const globalTriggerPatterns = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^jsconfig\.json$/,
  /^vite\.config\.js$/,
  /^tailwind\.config\.js$/,
  /^eslint\.config\.js$/,
  /^docker-compose\.yml$/,
  /^Dockerfile$/,
  /^apps\/desktop\/main\.js$/,
  /^apps\/desktop\/preload\.js$/,
  /^apps\/web\/src\/App\.jsx$/,
  /^apps\/desktop\/src\/localStore\//,
  /^backend\/public\/index\.php$/,
  /^backend\/desktop\/index\.php$/,
  /^backend\/ws-gateway\//,
  /^packages\/shared\/src\/lib\/dataSource\.js$/,
  /^packages\/shared\/src\/lib\/desktopSync\.js$/,
  /^backend\/src\/Application\/Service\//,
  /^backend\/src\/Infrastructure\/Persistence\/Repository\//,
  /^backend\/src\/Http\/Controller\//,
];

const knownTopLevel = new Set([
  ".github",
  ".idea",
  ".junie",
  "apps",
  "backend",
  "dist",
  "docs",
  "node_modules",
  "packages",
  "release",
  "scripts",
  "src.old",
  ".cursorignore",
  ".dockerignore",
  ".env",
  ".env.example",
  ".gitignore",
  ".prettiersrc",
  "AGENTS.md",
  "README.md",
  "backend-supervisor-csportfolio-sync.conf",
  "components.json",
  "config.example.json",
  "create_usd_column.php",
  "docker-compose.yml",
  "Dockerfile",
  "eslint.config.js",
  "fix-imports.js",
  "fix-imports.ps1",
  "fix-imports.py",
  "fix_select.py",
  "icon.ico",
  "jsconfig.json",
  "main.js",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "postcss.config.js",
  "preload.js",
  "supervisord.conf",
  "tailwind.config.js",
  "vite.config.js",
]);

const globalTriggers = [];

for (const path of changedPaths) {
  if (path === "package.json" && packageJsonVersionOnly) {
    continue;
  }
  if (path === "package-lock.json" && packageLockVersionOnly) {
    continue;
  }

  if (matchesAny(path, globalTriggerPatterns)) {
    globalTriggers.push(path);
    continue;
  }

  const topLevel = path.split("/")[0] || "";
  const entry = entries.find((candidate) => candidate.path === path);
  if (
    entry &&
    (entry.status === "A" || entry.status === "D" || entry.status === "R") &&
    topLevel &&
    !knownTopLevel.has(topLevel)
  ) {
    globalTriggers.push(path);
  }
}

const hasAgentsUpdate = changedPaths.includes("AGENTS.md");
const hasArchitectureUpdate = changedPaths.includes("docs/architecture-overview.md");

const agentsContent = fs.readFileSync("AGENTS.md", "utf8");
const activeDocPaths = parseActiveDocsTablePaths(agentsContent);
const newMarkdownEntries = entries.filter((entry) => {
  if (!(entry.status === "A" || entry.status === "R")) {
    return false;
  }
  const path = entry.path;
  if (!path.toLowerCase().endsWith(".md")) {
    return false;
  }
  if (path === "README.md" || path === "AGENTS.md") {
    return false;
  }
  return true;
});

const missingAgentsDocRows = newMarkdownEntries
  .map((entry) => entry.path)
  .filter((mdPath) => !activeDocPaths.has(mdPath));

const errors = [];

if (globalTriggers.length > 0) {
  if (!hasAgentsUpdate || !hasArchitectureUpdate) {
    const missing = [];
    if (!hasAgentsUpdate) {
      missing.push("AGENTS.md");
    }
    if (!hasArchitectureUpdate) {
      missing.push("docs/architecture-overview.md");
    }
    errors.push(
      [
        "Global change detected but governance docs were not both updated.",
        "Missing updates: " + missing.join(", "),
        "Triggers:",
        ...globalTriggers.map((trigger) => `- ${trigger}`),
      ].join("\n"),
    );
  }
}

if (missingAgentsDocRows.length > 0) {
  errors.push(
    [
      "New/renamed markdown files must be registered in AGENTS.md active docs table.",
      "Missing AGENTS.md entries:",
      ...missingAgentsDocRows.map((path) => `- ${path}`),
    ].join("\n"),
  );
}

if (errors.length > 0) {
  console.error("[docs-guard] FAILED\n");
  for (const error of errors) {
    console.error(error);
    console.error("");
  }
  process.exit(1);
}

console.log("[docs-guard] OK");
if (globalTriggers.length > 0) {
  console.log("[docs-guard] Global triggers:");
  for (const trigger of globalTriggers) {
    console.log(`- ${trigger}`);
  }
}
