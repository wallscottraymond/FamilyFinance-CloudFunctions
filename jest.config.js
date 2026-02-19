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

module.exports = {
  ...sharedConfig,
  roots: ['<rootDir>/src', '<rootDir>/__emulator_tests__'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)',
    '**/*.emulator.test.+(ts|tsx|js)'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,

  // Projects for different test types
  projects: [
    {
      // Unit tests (fast, no emulator)
      displayName: 'unit',
      ...sharedConfig,
      roots: ['<rootDir>/src'],
      testMatch: [
        '<rootDir>/src/**/__tests__/**/*.+(ts|tsx|js)',
        '<rootDir>/src/**/*.(test|spec).+(ts|tsx|js)'
      ],
      testPathIgnorePatterns: ['/node_modules/'],
      testTimeout: 10000
    },
    {
      // Emulator integration tests (slower, requires emulator)
      displayName: 'emulator',
      ...sharedConfig,
      roots: ['<rootDir>/__emulator_tests__'],
      testMatch: [
        '<rootDir>/__emulator_tests__/**/*.emulator.test.+(ts|tsx|js)'
      ],
      testTimeout: 30000 // Longer timeout for emulator tests
    }
  ]
};
