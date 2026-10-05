// Shared configuration
const sharedConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};

// Suites under src/ that use @firebase/rules-unit-testing (need the emulator).
const EMULATOR_SUITES_IN_SRC = [
  'src/__tests__/security/transaction-rules.test.ts',
  'src/functions/transactions/__tests__/transactionCRUD.integration.test.ts'
];

module.exports = {
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Global option (jest rejects it inside `projects`); the emulator project
  // raises it to 30s in its setup file.
  testTimeout: 10000,

  // Projects for different test types
  projects: [
    {
      // Unit tests (fast, no emulator). Only *.test / *.spec files — fixtures
      // and helpers under __tests__/ are not suites.
      displayName: 'unit',
      ...sharedConfig,
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/**/*.(test|spec).+(ts|tsx|js)'],
      // Suites that need the Firestore emulator run in the emulator project.
      testPathIgnorePatterns: ['/node_modules/', ...EMULATOR_SUITES_IN_SRC],
      // Point Firestore at an unreachable emulator so a unit test can never
      // touch the live project (dev == prod).
      setupFiles: ['<rootDir>/jest.unit.setup.js']
    },
    {
      // Emulator integration tests (slower, requires emulator)
      displayName: 'emulator',
      ...sharedConfig,
      roots: ['<rootDir>/__emulator_tests__', '<rootDir>/src'],
      testMatch: [
        '<rootDir>/__emulator_tests__/**/*.emulator.test.+(ts|tsx|js)',
        ...EMULATOR_SUITES_IN_SRC.map((p) => `<rootDir>/${p}`)
      ],
      setupFilesAfterEnv: ['<rootDir>/jest.emulator.setup.js']
    }
  ]
};
