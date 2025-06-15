const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

// Import the PlexMCPServer class
const PlexMCPServer = require('../../index.js');

describe('Error Handling Tests', () => {
  let server;
  let mock;

  beforeEach(() => {
    server = new PlexMCPServer();
    mock = new MockAdapter(axios);
    process.env.PLEX_TOKEN = 'test-token';
    process.env.PLEX_URL = 'http://localhost:32400';
  });

  afterEach(() => {
    mock.restore();
    delete process.env.PLEX_TOKEN;
    delete process.env.PLEX_URL;
  });

  describe('Environment Variable Validation', () => {
    it('should handle missing PLEX_TOKEN in handlePlexSearch', async () => {
      delete process.env.PLEX_TOKEN;
      mock.onGet().reply(404, 'Not Found');
      
      const result = await server.handlePlexSearch({ query: 'test' });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error searching Plex');
    });

    it('should handle missing PLEX_TOKEN in handleCreatePlaylist', async () => {
      delete process.env.PLEX_TOKEN;
      mock.onGet().reply(404, 'Not Found');
      
      const result = await server.handleCreatePlaylist({ title: 'Test', type: 'video', item_key: '123' });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error creating playlist');
    });

    it('should handle missing PLEX_TOKEN in handleBrowseLibraries', async () => {
      delete process.env.PLEX_TOKEN;
      mock.onGet().reply(404, 'Not Found');
      
      const result = await server.handleBrowseLibraries({});
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error browsing libraries');
    });
  });

  describe('Network Error Handling', () => {
    it('should handle 400 errors in playlist creation with detailed message', async () => {
      mock.onGet().reply(200, { MediaContainer: { machineIdentifier: 'test' } });
      mock.onPost().reply(400, '<html><head><title>Bad Request</title></head></html>');
      
      const result = await server.handleCreatePlaylist({ title: 'Test', type: 'video', item_key: '123' });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('400 Bad Request');
      expect(result.content[0].text).toContain('Plex server doesn\'t support playlist creation');
    });

    it('should handle generic errors in playlist creation', async () => {
      mock.onGet().reply(200, { MediaContainer: { machineIdentifier: 'test' } });
      mock.onPost().networkError();
      
      const result = await server.handleCreatePlaylist({ title: 'Test', type: 'video', item_key: '123' });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error creating playlist');
    });

    it('should handle 500 errors in search', async () => {
      mock.onGet().reply(500, 'Internal Server Error');
      
      const result = await server.handlePlexSearch({ query: 'test' });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error searching Plex');
    });

    it('should handle timeout errors', async () => {
      mock.onGet().timeout();
      
      const result = await server.handleBrowseLibraries({});
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error browsing libraries');
    });
  });

  describe('Playlist Error Handling', () => {
    it('should handle errors in handleAddToPlaylist', async () => {
      mock.onPut().reply(500, 'Server Error');
      
      const result = await server.handleAddToPlaylist({ playlist_id: '123', item_keys: ['456'] });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Playlist with ID 123 not found');
    });

    it('should handle errors in handleRemoveFromPlaylist', async () => {
      mock.onDelete().reply(404, 'Not Found');
      
      const result = await server.handleRemoveFromPlaylist({ playlist_id: '123', item_keys: ['456'] });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Playlist with ID 123 not found');
    });

    it('should handle errors in handleDeletePlaylist', async () => {
      mock.onDelete().reply(403, 'Forbidden');
      
      const result = await server.handleDeletePlaylist({ playlist_id: '123' });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error deleting playlist');
    });
  });

});