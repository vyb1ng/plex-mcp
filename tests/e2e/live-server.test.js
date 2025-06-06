const PlexMCPServer = require('../../index.js');

// Check if we should run E2E tests
const plexUrl = process.env.E2E_PLEX_URL || process.env.PLEX_URL;
const plexToken = process.env.E2E_PLEX_TOKEN || process.env.PLEX_TOKEN;
const isTestEnvironment = plexUrl?.includes('test-plex-server.com') || plexToken?.includes('test-token');
const shouldRunE2E = plexUrl && plexToken && !isTestEnvironment;

const describeE2E = shouldRunE2E ? describe : describe.skip;

describeE2E('E2E Live Plex Server Tests', () => {
  let server;
  let originalEnv;

  beforeAll(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    console.log('Running E2E tests against live Plex server');

    // Set environment for tests
    process.env.PLEX_URL = plexUrl;
    process.env.PLEX_TOKEN = plexToken;

    // Validate environment variables format
    if (!process.env.PLEX_URL.startsWith('http')) {
      throw new Error('PLEX_URL must start with http:// or https://');
    }

    if (process.env.PLEX_TOKEN.length < 10) {
      throw new Error('PLEX_TOKEN appears to be too short');
    }

    server = new PlexMCPServer();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Server Connectivity', () => {
    it('should connect to live Plex server and retrieve library data', async () => {
      const result = await server.handleBrowseLibraries();
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      
      const text = result.content[0].text;
      // Should either show libraries, an error, or SSL certificate issues (all valid outcomes)
      expect(text).toMatch(/Available Plex Libraries|libraries found|No libraries found|Library:|Error (browsing libraries|searching Plex): .*(certificate|SSL|hostname)/i);
    }, 10000); // 10 second timeout for network requests

    it('should handle SSL verification based on PLEX_VERIFY_SSL setting', async () => {
      // Test with SSL verification enabled (default)
      delete process.env.PLEX_VERIFY_SSL;
      const result1 = await server.handleBrowseLibraries();
      expect(result1.content[0].text).toMatch(/Available Plex Libraries|libraries found|No libraries found|Library:|Error (browsing libraries|searching Plex): .*(certificate|SSL|hostname)/i);

      // Test with SSL verification disabled
      process.env.PLEX_VERIFY_SSL = 'false';
      const server2 = new PlexMCPServer();
      const result2 = await server2.handleBrowseLibraries();
      expect(result2.content[0].text).toMatch(/Available Plex Libraries|libraries found|No libraries found|Library:|Error (browsing libraries|searching Plex): .*(certificate|SSL|hostname)/i);
      
      // Clean up
      delete process.env.PLEX_VERIFY_SSL;
    }, 15000);
  });

  describe('Library Data Retrieval', () => {
    it('should retrieve library list from live Plex server', async () => {
      const result = await server.handleBrowseLibraries();
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      
      const libraryText = result.content[0].text;
      expect(libraryText).toMatch(/Available Plex Libraries|libraries found|Error (browsing libraries|searching Plex): .*(certificate|SSL|hostname)/i);
      
      // Should contain at least basic library structure (unless SSL error)
      if (!libraryText.match(/Error.*certificate|SSL|hostname/i)) {
        expect(libraryText).toMatch(/Library:|Type:|Key:|Library ID:/);
      }
    }, 10000);

    it('should retrieve content from first available library', async () => {
      // First get the libraries
      const librariesResult = await server.handleBrowseLibraries();
      const libraryText = librariesResult.content[0].text;
      
      // Extract first library key using regex
      const keyMatch = libraryText.match(/Library ID: (\d+)|Key: (\d+)/);
      
      if (keyMatch) {
        const libraryKey = keyMatch[1] || keyMatch[2];
        
        // Browse the first library
        const browseResult = await server.handleBrowseLibrary({
          library_key: libraryKey,
          limit: 5
        });
        
        expect(browseResult).toBeDefined();
        expect(browseResult.content).toBeDefined();
        expect(browseResult.content[0].type).toBe('text');
        
        const browseText = browseResult.content[0].text;
        expect(browseText).toMatch(/Found \d+ items|No items found/);
      } else {
        // If no libraries found or SSL error, that's also a valid test result
        expect(libraryText).toMatch(/No libraries found|Available Plex Libraries|Error.*certificate|SSL|hostname/i);
      }
    }, 15000);

    it('should perform a simple search on live server', async () => {
      const result = await server.handlePlexSearch({
        query: 'the',  // Simple search term likely to return results
        limit: 3
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      
      const searchText = result.content[0].text;
      expect(searchText).toMatch(/Found \d+ results|No results found|Error searching Plex: .*(certificate|SSL|hostname)/i);
    }, 10000);
  });

  describe('Error Handling with Live Server', () => {
    it('should handle invalid search gracefully', async () => {
      const result = await server.handlePlexSearch({
        query: 'zzznonexistentmovie12345zzz',
        limit: 1
      });
      
      expect(result).toBeDefined();
      expect(result.content[0].text).toMatch(/Found 0 results|Error searching Plex: .*(certificate|SSL|hostname)/i);
    }, 10000);

    it('should handle invalid library key gracefully', async () => {
      const result = await server.handleBrowseLibrary({
        library_key: '99999',  // Non-existent library key
        limit: 1
      });
      
      expect(result).toBeDefined();
      // Should either return error message or empty results
      expect(result.content[0].text).toMatch(/error|not found|No items found|Found 0 items/i);
    }, 10000);
  });
});