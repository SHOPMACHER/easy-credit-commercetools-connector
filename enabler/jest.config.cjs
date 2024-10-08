/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['./test/jest.setup.ts'],
  roots: ['./test'],
  transformIgnorePatterns: [],
  transform: {
    '^.+\\.jsx?$': 'babel-jest', // Transform JavaScript files using Babel
    '^.+\\.ts?$': 'ts-jest', // Transform TypeScript files using ts-jest
  },
};
