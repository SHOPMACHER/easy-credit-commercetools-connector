module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['./test/jest.setup.ts'],
  roots: ['./test'],
};
