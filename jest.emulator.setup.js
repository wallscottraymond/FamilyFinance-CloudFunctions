// Emulator tests must never reach production (dev == prod, and the suites use the real project
// id). No real credentials; Firestore and Auth go to the emulator. Code under test that calls
// Auth (e.g. purge's best-effort deleteUser) then hits the Auth emulator, or fails fast, instead
// of production. Every suite also sets FIRESTORE_EMULATOR_HOST itself; this is the backstop.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:1';

// Emulator integration tests are slower than unit tests.
jest.setTimeout(30000);

// Per-test-file feature-flag collection: suites set / delete the global flag doc
// (`_feature_flags/convert_to_recurring_v1`) and run in parallel against one emulator, so each
// file gets its own collection (read by src/functions/infrastructure/feature_flags.ts).
process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE =
  `_feature_flags_t${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Start every suite from an empty emulator database. Several collections are global and matched
// by date (e.g. source_periods), so one suite's leftovers leaked into another's results. The
// endpoint exists only on the emulator. Suites run one at a time (test:emulator --maxWorkers=1),
// so clearing here can't race another suite.
beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/emulator/v1/projects/family-budget-app-cb59b/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`emulator clear failed: ${res.status}`);
});
