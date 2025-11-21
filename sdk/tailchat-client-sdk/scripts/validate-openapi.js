#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const SwaggerParser = require('@apidevtools/swagger-parser');

async function main() {
  const cwd = process.cwd();
  const target = path.resolve(cwd, 'openapi', 'openapi.json');
  try {
    const api = await SwaggerParser.validate(target);
    console.log(`[OpenAPI] validate OK: ${api.info && api.info.title ? api.info.title : 'OpenAPI'} ${api.openapi || api.swagger}`);
  } catch (err) {
    console.error('[OpenAPI] validate failed:', err?.message || String(err));
    if (err && err.details && Array.isArray(err.details)) {
      for (const d of err.details) {
        console.error('-', d.message, d.path ? `@ ${d.path}` : '');
      }
    }
    process.exit(1);
  }
}

main();


