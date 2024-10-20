/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  displayName: 'Tests Easycredit connector - shopmacher-easycredit-connector',
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/jest.setupAfterEnv.ts'],
  modulePathIgnorePatterns: ['<rootDir>/src/jest.setup.ts'],
  roots: ['./test'],
  reporters: ['default'],
};
