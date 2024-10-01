jest.mock('../src/libs/logger', () => ({
  log: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    level: 'debug',
  },
}));
