// Global test setup
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn()
};

// Set test environment variables
process.env.PLEX_URL = 'https://test-plex-server.com:32400';
process.env.PLEX_TOKEN = 'test-token-12345';

// Mock process.env for tests that need it
beforeEach(() => {
  jest.clearAllMocks();
});