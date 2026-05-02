#!/usr/bin/env node

/**
 * Fix all @/ imports to @shared/ in packages/shared and apps/web
 * Run: node fix-imports.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Allow __dirname equivalent in ESM modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const searchPaths = [
  'packages/shared/src',
  'apps/web/src'
];

const extensions = ['.jsx', '.js'];

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      walkDir(filePath, callback);
    } else if (extensions.includes(path.extname(file))) {
      callback(filePath);
    }
  });
}

function fixImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // Replace all @/ imports with @shared/
  content = content.replace(/from ["']@\//g, 'from "@shared/');
  content = content.replace(/from '@\//g, "from '@shared/");

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Fixed ${filePath}`);
    return true;
  }
  return false;
}

console.log('Starting import fixes...\n');

let fixed = 0;
searchPaths.forEach(searchPath => {
  walkDir(searchPath, (filePath) => {
    if (fixImports(filePath)) {
      fixed++;
    }
  });
});

console.log(`\n✅ Fixed ${fixed} files`);

