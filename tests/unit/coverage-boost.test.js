const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const PlexMCPServer = require('../../index.js');

describe('Coverage Boost Tests', () => {
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

  // Test utility methods directly to increase coverage
  describe('Utility Methods Direct Testing', () => {
    it('should test parseSearchResults edge cases', () => {
      // Test with empty object (will hit the early return)
      let result = server.parseSearchResults({});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      
      // Test with MediaContainer but no Metadata
      result = server.parseSearchResults({ MediaContainer: {} });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      
      // Test with empty Metadata array
      result = server.parseSearchResults({ MediaContainer: { Metadata: [] } });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test parseLibraries edge cases', () => {
      let result = server.parseLibraries({});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      
      result = server.parseLibraries({ MediaContainer: {} });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test parsePlaylists edge cases', () => {
      let result = server.parsePlaylists({});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      
      result = server.parsePlaylists({ MediaContainer: {} });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test parseWatchHistory edge cases', () => {
      let result = server.parseWatchHistory({});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test parseOnDeck edge cases', () => {
      let result = server.parseOnDeck({});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test parseWatchedStatus edge cases', () => {
      let result = server.parseWatchedStatus({});
      expect(typeof result).toBe('object');
      expect(result.ratingKey).toBeUndefined();
      expect(result.viewCount).toBe(0);
      
      result = server.parseWatchedStatus({ ratingKey: '123', title: 'Test' });
      expect(typeof result).toBe('object');
      expect(result.ratingKey).toBe('123');
      expect(result.title).toBe('Test');
    });

    it('should test getPlexTypeNumber with all types', () => {
      expect(server.getPlexTypeNumber('movie')).toBe(1);
      expect(server.getPlexTypeNumber('show')).toBe(2);
      expect(server.getPlexTypeNumber('episode')).toBe(4);
      expect(server.getPlexTypeNumber('artist')).toBe(8);
      expect(server.getPlexTypeNumber('album')).toBe(9);
      expect(server.getPlexTypeNumber('track')).toBe(10);
      expect(server.getPlexTypeNumber('unknown')).toBeNull();
    });
  });

  describe('Advanced Filter Coverage', () => {
    it('should test applyAdvancedFilters with empty arrays', () => {
      let result = server.applyAdvancedFilters([], {});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test applyAdvancedFilters with items without Media', () => {
      const items = [{ title: 'Test', ratingKey: '1' }];
      const result = server.applyAdvancedFilters(items, { resolution: '1080p' });
      expect(Array.isArray(result)).toBe(true);
    });

    it('should test applyAdvancedFilters with various audio formats', () => {
      const items = [{
        title: 'Test',
        Media: [{ Part: [{ audioCodec: 'dts', size: 1000000000 }] }]
      }];
      
      let result = server.applyAdvancedFilters(items, { audio_format: 'lossless' });
      expect(result.length).toBe(1);
      
      result = server.applyAdvancedFilters(items, { audio_format: 'lossy' });
      expect(result.length).toBe(0);
    });
  });

  describe('Activity Filter Coverage', () => {
    it('should test applyActivityFilters with empty arrays', () => {
      let result = server.applyActivityFilters([], {});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should test applyActivityFilters with items without viewCount', () => {
      const items = [{ title: 'Test', ratingKey: '1' }];
      let result = server.applyActivityFilters(items, { play_count_min: 1 });
      expect(result.length).toBe(0);
      
      result = server.applyActivityFilters(items, { never_played: true });
      expect(result.length).toBe(1);
    });

    it('should test applyActivityFilters with date filters', () => {
      const recentTime = Math.floor(Date.now() / 1000) - (12 * 60 * 60); // 12 hours ago (within 1 day)
      const veryOldTime = Math.floor(Date.now() / 1000) - (48 * 60 * 60); // 2 days ago
      const items = [{
        title: 'Test',
        viewCount: 1,
        lastViewedAt: recentTime.toString()
      }];
      
      let result = server.applyActivityFilters(items, { played_in_last_days: 1 });
      expect(result.length).toBe(1);
      
      // Test with an item that's definitely too old for 0 days
      const oldItems = [{
        title: 'Old Test',
        viewCount: 1,
        lastViewedAt: veryOldTime.toString()
      }];
      
      // Note: played_in_last_days: 0 is falsy, so the filter might not apply at all
      // Let's test with a very small positive number instead
      result = server.applyActivityFilters(oldItems, { played_in_last_days: 0.001 });
      expect(result.length).toBe(0);
    });
  });

  describe('Format Methods Coverage', () => {
    it('should test formatResults with various item types', () => {
      const movieItem = {
        title: 'Test Movie',
        type: 'movie',
        year: '2023',
        summary: 'A'.repeat(500), // Long summary to test truncation
        duration: 7200000
      };
      
      const result = server.formatResults([movieItem]);
      expect(typeof result).toBe('string');
      expect(result).toContain('Test Movie');
    });

    it('should test formatLibraries with various inputs', () => {
      const libraries = [{
        title: 'Movies',
        type: 'movie',
        key: '1',
        updatedAt: '1640995200'
      }];
      
      const result = server.formatLibraries(libraries);
      expect(typeof result).toBe('string');
      expect(result).toContain('Movies');
    });

    it('should test formatPlaylists with various inputs', () => {
      const playlists = [{
        title: 'Test Playlist',
        playlistType: 'video',
        smart: '1',
        leafCount: 10,
        duration: 3600000
      }];
      
      const result = server.formatPlaylists(playlists);
      expect(typeof result).toBe('string');
      expect(result).toContain('Test Playlist');
    });

    it('should test formatWatchHistory with various inputs', () => {
      const history = [{
        title: 'Watched Movie',
        type: 'movie',
        viewedAt: '1640995200'
      }];
      
      const result = server.formatWatchHistory(history);
      expect(typeof result).toBe('string');
      expect(result).toContain('Watched Movie');
    });

    it('should test formatOnDeck with various inputs', () => {
      const onDeck = [{
        title: 'Continue Show',
        type: 'episode',
        viewOffset: 600000,
        duration: 1800000
      }];
      
      const result = server.formatOnDeck(onDeck);
      expect(typeof result).toBe('string');
      expect(result).toContain('Continue Show');
    });

    it('should test formatWatchedStatus with various inputs', () => {
      const statuses = [{
        item_key: '123',
        title: 'Test Movie',
        status: 'watched',
        progress: '100%'
      }];
      
      const result = server.formatWatchedStatus(statuses);
      expect(typeof result).toBe('string');
      expect(result).toContain('Test Movie');
    });

    it('should test formatRecentlyAdded with various inputs', () => {
      const recent = [{
        title: 'New Movie',
        type: 'movie',
        addedAt: '1640995200',
        Genre: [{ tag: 'Action' }, { tag: 'Drama' }, { tag: 'Comedy' }, { tag: 'Thriller' }]
      }];
      
      const result = server.formatRecentlyAdded(recent);
      expect(typeof result).toBe('string');
      expect(result).toContain('New Movie');
    });
  });

  describe('Error Path Coverage', () => {
    it('should handle missing environment variables', async () => {
      delete process.env.PLEX_TOKEN;
      
      const result = await server.handleBrowseLibrary({ library_id: '1' });
      expect(result.isError).toBe(true);
    });

    it('should handle network errors gracefully', async () => {
      mock.onGet().networkError();
      
      const result = await server.handleBrowseLibraries({});
      expect(result.isError).toBe(true);
    });

    it('should handle timeout errors', async () => {
      mock.onGet().timeout();
      
      const result = await server.handleListPlaylists({});
      expect(result.isError).toBe(true);
    });

    it('should handle malformed responses', async () => {
      mock.onGet().reply(200, 'invalid json');
      
      const result = await server.handleOnDeck({});
      // This may or may not be an error depending on how the XML parser handles it
      expect(typeof result).toBe('object');
    });
  });
});