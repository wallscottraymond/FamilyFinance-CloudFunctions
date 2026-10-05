// Unit tests must never reach a real Firestore: `dev` and `default` are the
// same live project (family-budget-app-cb59b). Any test that initializes the
// real Admin SDK talks to this unreachable "emulator" instead and fails, even
// when GOOGLE_APPLICATION_CREDENTIALS is set in the shell.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.GCLOUD_PROJECT = 'demo-unit-tests';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-unit-tests';
