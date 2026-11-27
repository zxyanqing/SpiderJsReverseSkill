#!/usr/bin/env node
'use strict';

/**
 * Download and verify pinned FingerprintJS source + npm dist.
 * Output is a NEW directory (not inside this skill tree by default).
 *
 * Usage:
 *   node cases/fingerprintjs-local/prepare.mjs --output /absolute/path/new-assets
 *   node cases/fingerprintjs-local/prepare.mjs --output /abs/out --cache-dir /abs/archive-cache
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const MAX_BYTES = 80 * 1024 * 1024;

function fail(msg) {
  console.error(`[prepare] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { output: null, cacheDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output') out.output = argv[++i];
    else if (a === '--cache-dir') out.cacheDir = argv[++i];
    else fail(`unknown arg: ${a}`);
  }
  if (!out.output) fail('required: --output /absolute/path (must not exist yet)');
  return out;
}

function assertSafeOutput(output) {
  if (!path.isAbsolute(output)) fail('--output must be absolute');
  if (output.split(path.sep).includes('..')) fail('--output must not contain ..');
  const parentIn = path.dirname(path.resolve(output));
  if (!fs.existsSync(parentIn)) fail(`parent directory missing: ${parentIn}`);
  // macOS /tmp 等常为 symlink：归一到 realpath，避免拒收合法输出。
  const parent = fs.realpathSync(parentIn);
  const resolved = path.join(parent, path.basename(path.resolve(output)));
  if (fs.existsSync(resolved)) fail(`--output already exists: ${resolved}`);
  return resolved;
}

function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let size = 0;
    const get = url.startsWith('http://') ? http.get : https.get;
    const req = get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        const next = res.headers.location;
        if (!next.startsWith('https://')) {
          reject(new Error('redirect left HTTPS'));
          return;
        }
        download(next, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new Error('download exceeds size limit'));
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(size)));
    });
    req.on('error', reject);
  });
}

async function obtainArchive(pin, downloadsDir, cacheDir) {
  const dest = path.join(downloadsDir, pin.archive);
  let obtainedFrom = 'download';
  if (cacheDir) {
    const cached = path.join(cacheDir, pin.archive);
    if (fs.existsSync(cached)) {
      fs.copyFileSync(cached, dest);
      obtainedFrom = 'cache';
    }
  }
  if (!fs.existsSync(dest)) {
    await download(pin.url, dest);
    obtainedFrom = 'download';
  }
  const actual = sha256File(dest);
  if (actual !== pin.sha256) {
    fail(`SHA256 mismatch for ${pin.name}: expected ${pin.sha256}, got ${actual}`);
  }
  return { dest, obtainedFrom, verifiedSha256: actual, bytes: fs.statSync(dest).size };
}

function extractTarGz(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync('tar', ['-xzf', archive, '-C', destDir], { encoding: 'utf8' });
  if (r.status !== 0) fail(`tar extract failed: ${r.stderr || r.stdout}`);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const output = assertSafeOutput(args.output);
  fs.mkdirSync(output, { recursive: true });
  const downloads = path.join(output, 'downloads');
  const vendor = path.join(output, 'vendor');
  fs.mkdirSync(downloads, { recursive: true });
  fs.mkdirSync(vendor, { recursive: true });

  const evidence = {
    caseId: sources.caseId,
    expectedVersion: sources.expectedVersion,
    preparedAt: new Date().toISOString(),
    node: process.version,
    sources: [],
    status: 'running',
  };

  try {
    for (const pin of sources.sources) {
      const got = await obtainArchive(pin, downloads, args.cacheDir);
      const extractRoot = path.join(vendor, pin.name);
      extractTarGz(got.dest, extractRoot);
      evidence.sources.push({
        name: pin.name,
        kind: pin.kind,
        url: pin.url,
        commit: pin.commit || null,
        version: pin.version,
        archive: pin.archive,
        expectedSha256: pin.sha256,
        verifiedSha256: got.verifiedSha256,
        obtainedFrom: got.obtainedFrom,
        bytes: got.bytes,
        license: pin.license,
        extractRoot: path.relative(output, extractRoot),
      });
    }

    // Normalize runnable dist path for this case.
    const npmRoot = path.join(vendor, 'fingerprintjs-npm-dist');
    const packageDir = fs.readdirSync(npmRoot).find((n) => n === 'package')
      ? path.join(npmRoot, 'package')
      : npmRoot;
    const distCjs = path.join(packageDir, 'dist', 'fp.cjs.js');
    const distUmd = path.join(packageDir, 'dist', 'fp.umd.js');
    if (!fs.existsSync(distCjs)) fail(`missing dist after extract: ${distCjs}`);
    if (!fs.existsSync(distUmd)) fail(`missing UMD dist after extract: ${distUmd}`);
    const licensePath = path.join(packageDir, 'LICENSE');
    if (!fs.existsSync(licensePath)) fail('missing MIT LICENSE in npm package');

    const runnable = {
      distCjs: path.relative(output, distCjs),
      distUmd: path.relative(output, distUmd),
      license: path.relative(output, licensePath),
      expectedVersion: sources.expectedVersion,
      packageJson: path.relative(output, path.join(packageDir, 'package.json')),
      loadPath: 'page-script',
    };
    writeJson(path.join(output, 'RUNNABLE.json'), runnable);

    evidence.status = 'ok';
    writeJson(path.join(output, 'PREPARE.json'), evidence);

    const sums = [];
    for (const rel of ['PREPARE.json', 'RUNNABLE.json', ...evidence.sources.map((s) => path.join('downloads', path.basename(s.archive)))]) {
      const abs = path.join(output, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        sums.push(`${sha256File(abs)}  ${rel}`);
      }
    }
    fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);

    console.log(JSON.stringify({ ok: true, output, runnable }, null, 2));
  } catch (err) {
    evidence.status = 'failed';
    evidence.error = String(err && err.message ? err.message : err);
    writeJson(path.join(output, 'PREPARE.json'), evidence);
    fail(evidence.error);
  }
}

main();
