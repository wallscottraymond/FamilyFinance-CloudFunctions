#!/usr/bin/env node
/**
 * inspect-firestore.js — READ-ONLY inspector for the live Firestore database.
 *
 * Connects to the real project (family-budget-app-cb59b) and prints documents.
 * It NEVER writes: it only ever calls .get()/.where()/.limit()/.orderBy()/
 * .select()/.count(). There is no set/update/delete path in this file.
 *
 * Credentials (first match wins):
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var
 *   2. ~/google-service-account-key.json
 *   3. ~/.config/firebase/service-accounts/family-budget-app-cb59b.json
 *   4. ./serviceAccount.json  (repo root; gitignored)
 *   5. application-default credentials
 *
 * One-time setup: Firebase Console → Project Settings → Service Accounts →
 * "Generate new private key" → save to one of the paths above.
 *
 * Usage:
 *   node scripts/inspect-firestore.js <collection> [options]
 *
 * Options:
 *   --id <docId>             Fetch a single document by id
 *   --where <field><op><val> Filter (op ∈ == != > >= < <=; bare "=" means ==).
 *                            Repeatable. e.g. --where userId=abc --where isActive=true
 *   --limit <n>              Max docs (default 20)
 *   --order <field[:desc]>   Order by a field
 *   --select <f1,f2,...>     Only print these fields
 *   --count                  Print only the match count (no docs)
 *   --json                   Raw JSON output (default: pretty)
 *
 * Examples:
 *   node scripts/inspect-firestore.js accounts --where userId=<uid> --limit 10
 *   node scripts/inspect-firestore.js transactions --where accountId=<acct> --where isHidden=true
 *   node scripts/inspect-firestore.js plaid_items --id <docId>
 *   node scripts/inspect-firestore.js outflows --where accountId=<acct> --count
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';

// ---------------------------------------------------------------------------
// Credential resolution (read-only connection to the LIVE project)
// ---------------------------------------------------------------------------
function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(os.homedir(), '.config/firebase/service-accounts', `${PROJECT_ID}.json`),
    path.join(__dirname, '..', 'serviceAccount.json'),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.error(`🔑 Using service-account key: ${p}`);
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return admin.credential.cert(require(p));
      }
    } catch (_e) {
      /* keep trying */
    }
  }
  console.error('🔑 No key file found — falling back to application-default credentials.');
  return admin.credential.applicationDefault();
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { wheres: [], limit: 20 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--where') args.wheres.push(argv[++i]);
    else if (a === '--id') args.id = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--order') args.order = argv[++i];
    else if (a === '--select') args.select = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--count') args.count = true;
    else if (a === '--json') args.json = true;
    else positional.push(a);
  }
  args.collection = positional[0];
  return args;
}

function coerce(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

const OPS = ['==', '!=', '>=', '<=', '>', '<'];
function parseWhere(expr) {
  for (const op of OPS) {
    const idx = expr.indexOf(op);
    if (idx > 0) {
      return { field: expr.slice(0, idx), op, value: coerce(expr.slice(idx + op.length)) };
    }
  }
  // bare "field=value" → equality
  const eq = expr.indexOf('=');
  if (eq > 0) {
    return { field: expr.slice(0, eq), op: '==', value: coerce(expr.slice(eq + 1)) };
  }
  throw new Error(`Invalid --where expression: "${expr}"`);
}

// ---------------------------------------------------------------------------
// Pretty printing (Timestamps → ISO)
// ---------------------------------------------------------------------------
function normalize(value) {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}

function printDoc(doc, select, asJson) {
  let data = normalize(doc.data());
  if (select) {
    const filtered = {};
    for (const f of select) filtered[f] = data[f];
    data = filtered;
  }
  if (asJson) {
    console.log(JSON.stringify({ id: doc.id, ...data }));
  } else {
    console.log(`\n• ${doc.id}`);
    console.log(JSON.stringify(data, null, 2).split('\n').map((l) => `  ${l}`).join('\n'));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.collection) {
    console.error('Usage: node scripts/inspect-firestore.js <collection> [--id|--where|--limit|--order|--select|--count|--json]');
    process.exit(1);
  }

  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  console.error(`📖 READ-ONLY · project=${PROJECT_ID} · collection=${args.collection}\n`);

  // Single document by id
  if (args.id) {
    const snap = await db.collection(args.collection).doc(args.id).get();
    if (!snap.exists) {
      console.error(`(no document ${args.collection}/${args.id})`);
      process.exit(0);
    }
    printDoc(snap, args.select, args.json);
    return;
  }

  // Query
  let q = db.collection(args.collection);
  for (const w of args.wheres) {
    const { field, op, value } = parseWhere(w);
    q = q.where(field, op, value);
  }
  if (args.order) {
    const [field, dir] = args.order.split(':');
    q = q.orderBy(field, dir === 'desc' ? 'desc' : 'asc');
  }

  if (args.count) {
    const c = await q.count().get();
    console.log(`count = ${c.data().count}`);
    return;
  }

  q = q.limit(args.limit);
  const snap = await q.get();
  if (snap.empty) {
    console.error('(no matching documents)');
    return;
  }
  snap.docs.forEach((d) => printDoc(d, args.select, args.json));
  console.error(`\n${snap.size} document(s)${snap.size === args.limit ? ` (capped at --limit ${args.limit})` : ''}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ inspect-firestore failed:', err.message);
    process.exit(1);
  });
