const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

// Import the PlexMCPServer class
const PlexMCPServer = require('../../index.js');

describe('Handler Functions Tests', () => {
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

  describe('handleGetCollections', () => {
    it('should handle API errors', async () => {
      mock.onGet().reply(500, 'Server Error');

      const result = await server.handleGetCollections({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting collections');
    });
  });


  describe('Smart Playlist Creation', () => {
    it.skip('should handle smart playlist creation (disabled feature)', async () => {
      const mockResponse = {
        MediaContainer: {
          Metadata: [{
            ratingKey: '456',
            title: 'Smart Test Playlist',
            smart: '1',
            playlistType: 'audio'
          }]
        }
      };

      mock.onGet().reply(200, { MediaContainer: { machineIdentifier: 'test' } });
      mock.onPost().reply(200, mockResponse);

      const result = await server.handleCreatePlaylist({ 
        title: 'Smart Test Playlist', 
        type: 'audio', 
        smart: true 
      });

      expect(result.content[0].text).toContain('smart playlist');
      expect(result.content[0].text).toContain('Smart Test Playlist');
    });
  });
});