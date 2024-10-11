/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  collectCoverage: true, // Enable coverage collection
  collectCoverageFrom: ['src/**/*.{ts,js}'], // Scan all files in src/ for coverage
  coverageDirectory: 'coverage', // Output folder for coverage reports
  displayName: 'Tests Easycredit connector - shopmacher-easycredit-connector',
  moduleDirectories: ['node_modules', 'src'],
  testMatch: ['**/tests/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/jest.setupAfterEnv.ts'],
  modulePathIgnorePatterns: ['<rootDir>/src/jest.setup.ts'],
  reporters: ['default'],
};
