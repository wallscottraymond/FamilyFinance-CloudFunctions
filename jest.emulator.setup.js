// Emulator integration tests are slower than unit tests.
jest.setTimeout(30000);

// Per-test-file feature-flag collection: suites set / delete the global flag doc
// (`_feature_flags/convert_to_recurring_v1`) and run in parallel against one emulator, so each
// file gets its own collection (read by src/functions/infrastructure/feature_flags.ts).
process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE =
  `_feature_flags_t${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
