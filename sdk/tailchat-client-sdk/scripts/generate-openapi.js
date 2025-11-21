#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function resolveExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function deepSort(obj) {
  if (Array.isArray(obj)) return obj.map(deepSort);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = deepSort(obj[k]);
    }
    return out;
  }
  return obj;
}

function loadDoc(file) {
  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    const raw = fs.readFileSync(file, 'utf8');
    return yaml.load(raw);
  }
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function hasBotPaths(doc) {
  if (!doc || !doc.paths) return false;
  return Object.keys(doc.paths || {}).some((p) => String(p).startsWith('/openapi.bot/'));
}

function extractPathsFromBaseTs(baseFile) {
  const out = new Set();
  if (!fs.existsSync(baseFile)) return out;
  const text = fs.readFileSync(baseFile, 'utf8');
  // this.buildApiPath('/openapi/bot/answerCallbackQuery')
  const reBuild = /buildApiPath\(\s*['"]([^'\"]+)['"]\s*\)/g;
  let m;
  while ((m = reBuild.exec(text)) !== null) {
    const p = m[1];
    const norm = p.startsWith('/') ? `/api${p}` : `/api/${p}`;
    out.add(norm);
  }
  // this.call('openapi.bot.sendMessage') -> /api/openapi/bot/sendMessage
  const reCall = /\bcall\(\s*['"]([^'\"]+)['"]/g;
  while ((m = reCall.exec(text)) !== null) {
    const act = m[1];
    const norm = `/api/${act.replace(/\./g, '/')}`;
    out.add(norm);
  }
  return out;
}

function findPathInDoc(doc, wantedPath) {
  if (!doc || !doc.paths) return null;
  const candidates = [];
  candidates.push(wantedPath);
  // strip /api prefix
  if (wantedPath.startsWith('/api/')) candidates.push(wantedPath.slice(4));
  // map /api/openapi/bot/* -> /openapi.bot/*
  if (wantedPath.startsWith('/api/openapi/bot/')) {
    candidates.push('/openapi.bot/' + wantedPath.slice('/api/openapi/bot/'.length));
  }
  if (wantedPath.startsWith('/api/openapi/app/')) {
    candidates.push('/openapi.app/' + wantedPath.slice('/api/openapi/app/'.length));
  }
  for (const c of candidates) {
    if (doc.paths[c]) return c;
  }
  return null;
}

async function main() {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, '..', '..', 'server', 'openapi.yaml'),
    path.resolve(cwd, '..', '..', 'server', 'openapi.yml'),
    path.resolve(cwd, '..', '..', 'server', 'openapi.json'),
  ];
  const existing = candidates.filter((p) => fs.existsSync(p));
  if (existing.length === 0) {
    console.error('[OpenAPI] source not found. Tried:', candidates.join(', '));
    process.exit(1);
    return;
  }

  // Extract wanted paths from base.ts
  const baseTs = path.resolve(cwd, 'src', 'openapi', 'client', 'base.ts');
  const wanted = Array.from(extractPathsFromBaseTs(baseTs));
  if (wanted.length === 0) {
    console.error('[OpenAPI] no paths found from base.ts');
  }

  // Choose the source that can match most wanted paths
  let chosen = existing[0];
  let chosenDoc = loadDoc(chosen);
  let bestScore = 0;
  for (const f of existing) {
    try {
      const d = loadDoc(f);
      let score = 0;
      for (const w of wanted) {
        if (findPathInDoc(d, w)) score += 1;
      }
      if (score > bestScore) { bestScore = score; chosen = f; chosenDoc = d; }
    } catch {}
  }

  let doc = chosenDoc;

  // Basic sanity
  if (!doc.openapi) {
    console.warn('[OpenAPI] missing openapi field; adding 3.0.3 by default');
    doc.openapi = '3.0.3';
  }

  // Build new doc only with base.ts endpoints
  const newDoc = {
    openapi: doc.openapi || '3.0.3',
    info: doc.info || { title: 'Tailchat OpenAPI (base.ts subset)', version: '0.0.0' },
    servers: doc.servers || [],
    paths: {},
    components: doc.components || {},
  };

  const pathsOut = {};
  for (const w of wanted) {
    const actual = findPathInDoc(doc, w);
    if (actual && doc.paths[actual]) {
      pathsOut[w] = doc.paths[actual];
      continue;
    }
    // Fallback skeleton (POST)
    pathsOut[w] = {
      post: {
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'OK' } },
      },
    };
  }
  newDoc.paths = pathsOut;

  const normalized = deepSort(newDoc);

  const outDir = path.resolve(cwd, 'openapi');
  fs.mkdirSync(outDir, { recursive: true });
  const outJson = path.join(outDir, 'openapi.json');
  const outMin = path.join(outDir, 'openapi.min.json');

  fs.writeFileSync(outJson, JSON.stringify(normalized, null, 2));
  fs.writeFileSync(outMin, JSON.stringify(normalized));
  console.log('[OpenAPI] generated:', outJson);
}

main().catch((err) => {
  console.error('[OpenAPI] generation failed:', err?.stack || String(err));
  process.exit(1);
});


