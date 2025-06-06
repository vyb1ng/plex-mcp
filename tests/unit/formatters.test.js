const PlexMCPServer = require('../../index.js');

describe('Formatter Functions', () => {
  let server;

  beforeEach(() => {
    server = new PlexMCPServer();
  });

  describe('formatResults', () => {
    it('should format movie results correctly', () => {
      const results = [
        {
          title: 'Test Movie',
          type: 'movie',
          year: 2023,
          rating: 8.5,
          summary: 'A test movie for unit testing'
        }
      ];

      const formatted = server.formatResults(results);
      
      expect(formatted).toContain('1. **Test Movie** (2023) - movie - Rating: 8.5');
      expect(formatted).toContain('A test movie for unit testing');
    });

    it('should format TV show episodes correctly', () => {
      const results = [
        {
          title: 'Episode Title',
          grandparentTitle: 'Test TV Show',
          parentIndex: 1,
          index: 1,
          year: 2023,
          summary: 'First episode of the show'
        }
      ];

      const formatted = server.formatResults(results);
      
      expect(formatted).toContain('1. **Episode Title**');
      expect(formatted).toContain('(2023)');
      expect(formatted).toContain('First episode of the show');
    });

    it('should handle missing optional fields', () => {
      const results = [
        {
          title: 'Basic Movie'
        }
      ];

      const formatted = server.formatResults(results);
      
      expect(formatted).toBe('1. **Basic Movie**');
    });

    it('should truncate long summaries', () => {
      const longSummary = 'A'.repeat(200);
      const results = [
        {
          title: 'Long Summary Movie',
          summary: longSummary
        }
      ];

      const formatted = server.formatResults(results);
      
      expect(formatted).toContain('...');
      expect(formatted.length).toBeLessThan(longSummary.length + 50);
    });
  });

  describe('formatLibraries', () => {
    it('should format libraries correctly', () => {
      const libraries = [
        {
          title: 'Movies',
          type: 'movie',
          agent: 'com.plexapp.agents.themoviedb',
          language: 'en',
          scannedAt: 1703270400,
          key: '1'
        }
      ];

      const formatted = server.formatLibraries(libraries);
      
      expect(formatted).toContain('1. **Movies** (movie)');
      expect(formatted).toContain('Agent: com.plexapp.agents.themoviedb');
      expect(formatted).toContain('Language: en');
      expect(formatted).toContain('Last scanned:');
      expect(formatted).toContain('Library ID: 1');
    });

    it('should handle missing optional fields', () => {
      const libraries = [
        {
          title: 'Basic Library',
          type: 'movie',
          key: '1'
        }
      ];

      const formatted = server.formatLibraries(libraries);
      
      expect(formatted).toContain('1. **Basic Library** (movie)');
      expect(formatted).toContain('Library ID: 1');
      expect(formatted).not.toContain('Agent:');
    });
  });

  describe('formatPlaylists', () => {
    it('should format regular playlists correctly', () => {
      const playlists = [
        {
          title: 'My Music Playlist',
          playlistType: 'audio',
          smart: false,
          leafCount: 15,
          duration: 3600000, // 1 hour
          updatedAt: 1703184000,
          ratingKey: 'pl001'
        }
      ];

      const formatted = server.formatPlaylists(playlists);
      
      expect(formatted).toContain('1. **My Music Playlist** (audio)');
      expect(formatted).toContain('Items: 15');
      expect(formatted).toContain('Duration: 1h 0m');
      expect(formatted).toContain('Playlist ID: pl001');
      expect(formatted).not.toContain('Smart Playlist');
    });

    it('should format smart playlists correctly', () => {
      const playlists = [
        {
          title: 'Smart Playlist',
          playlistType: 'video',
          smart: true,
          leafCount: 25,
          ratingKey: 'pl002'
        }
      ];

      const formatted = server.formatPlaylists(playlists);
      
      expect(formatted).toContain('Smart Playlist');
    });

    it('should format duration with hours and minutes', () => {
      const playlists = [
        {
          title: 'Long Playlist',
          duration: 9000000, // 2.5 hours
          ratingKey: 'pl003'
        }
      ];

      const formatted = server.formatPlaylists(playlists);
      
      expect(formatted).toContain('Duration: 2h 30m');
    });
  });

  describe('formatWatchHistory', () => {
    it('should format movie watch history correctly', () => {
      const history = [
        {
          title: 'Test Movie',
          type: 'movie',
          year: 2023,
          viewedAt: 1703184000,
          viewOffset: 7200000,
          duration: 7200000,
          deviceID: 'test-device'
        }
      ];

      const formatted = server.formatWatchHistory(history);
      
      expect(formatted).toContain('1. **Test Movie** (2023)');
      expect(formatted).toContain('Watched:');
      expect(formatted).toContain('Progress: 100%');
      expect(formatted).toContain('Device: test-device');
    });

    it('should format TV show episode history correctly', () => {
      const history = [
        {
          title: 'Episode Title',
          grandparentTitle: 'Test TV Show',
          parentIndex: 1,
          index: 1,
          viewedAt: 1703184000,
          viewOffset: 1350000,
          duration: 2700000
        }
      ];

      const formatted = server.formatWatchHistory(history);
      
      expect(formatted).toContain('1. **Test TV Show** S1E1 - Episode Title');
      expect(formatted).toContain('Progress: 50%');
    });

    it('should handle missing progress information', () => {
      const history = [
        {
          title: 'Movie Without Progress',
          viewedAt: 1703184000
        }
      ];

      const formatted = server.formatWatchHistory(history);
      
      expect(formatted).toContain('1. **Movie Without Progress**');
      expect(formatted).not.toContain('Progress:');
    });
  });

  describe('formatOnDeck', () => {
    it('should format on deck items correctly', () => {
      const onDeck = [
        {
          title: 'Episode Title',
          grandparentTitle: 'Test TV Show',
          parentIndex: 1,
          index: 2,
          viewOffset: 900000, // 15 minutes
          duration: 2700000, // 45 minutes
          lastViewedAt: 1703270400,
          summary: 'Continue watching this episode'
        }
      ];

      const formatted = server.formatOnDeck(onDeck);
      
      expect(formatted).toContain('1. **Test TV Show** S1E2 - Episode Title');
      expect(formatted).toContain('Progress: 33%');
      expect(formatted).toContain('30 min remaining');
      expect(formatted).toContain('Last watched:');
      expect(formatted).toContain('Continue watching this episode');
    });

    it('should format movie on deck correctly', () => {
      const onDeck = [
        {
          title: 'Test Movie',
          year: 2023,
          viewOffset: 3600000, // 1 hour
          duration: 7200000, // 2 hours
          lastViewedAt: 1703270400
        }
      ];

      const formatted = server.formatOnDeck(onDeck);
      
      expect(formatted).toContain('1. **Test Movie** (2023)');
      expect(formatted).toContain('Progress: 50%');
      expect(formatted).toContain('60 min remaining');
    });
  });

  describe('formatWatchedStatus', () => {
    it('should format fully watched status', () => {
      const status = [
        {
          title: 'Watched Movie',
          year: 2023,
          watched: true,
          viewCount: 2,
          lastViewedAt: 1703184000,
          ratingKey: '12345'
        }
      ];

      const formatted = server.formatWatchedStatus(status);
      
      expect(formatted).toContain('1. **Watched Movie** (2023)');
      expect(formatted).toContain('Status: ✅ Watched (2 times)');
      expect(formatted).toContain('Last watched:');
      expect(formatted).toContain('Item ID: 12345');
    });

    it('should format partially watched status', () => {
      const status = [
        {
          title: 'In Progress Movie',
          watched: false,
          partiallyWatched: true,
          viewOffset: 3600000,
          duration: 7200000,
          ratingKey: '67890'
        }
      ];

      const formatted = server.formatWatchedStatus(status);
      
      expect(formatted).toContain('Status: ⏸️ In Progress (50% complete, 60m remaining)');
    });

    it('should format unwatched status', () => {
      const status = [
        {
          title: 'Unwatched Movie',
          watched: false,
          partiallyWatched: false,
          ratingKey: '99999'
        }
      ];

      const formatted = server.formatWatchedStatus(status);
      
      expect(formatted).toContain('Status: ⬜ Unwatched');
    });

    it('should format error status', () => {
      const status = [
        {
          title: 'Unknown',
          ratingKey: 'invalid',
          error: 'Item not found'
        }
      ];

      const formatted = server.formatWatchedStatus(status);
      
      expect(formatted).toContain('Error: Item not found');
    });

    it('should format TV show episodes correctly', () => {
      const status = [
        {
          title: 'Episode Title',
          grandparentTitle: 'Test TV Show',
          parentIndex: 1,
          index: 1,
          watched: true,
          viewCount: 1,
          ratingKey: '11111'
        }
      ];

      const formatted = server.formatWatchedStatus(status);
      
      expect(formatted).toContain('1. **Test TV Show** S1E1 - Episode Title');
    });
  });

  describe('formatRecentlyAdded', () => {
    it('should format recently added items correctly', () => {
      const items = [
        {
          title: 'New Movie',
          year: 2023,
          type: 'movie',
          addedAt: 1703184000,
          genres: ['Action', 'Adventure', 'Sci-Fi'],
          summary: 'A newly added action movie'
        }
      ];

      const formatted = server.formatRecentlyAdded(items);
      
      expect(formatted).toContain('1. **New Movie** (2023) - movie');
      expect(formatted).toContain('Added:');
      expect(formatted).toContain('Genres: Action, Adventure, Sci-Fi');
      expect(formatted).toContain('A newly added action movie');
    });

    it('should limit genres to 3', () => {
      const items = [
        {
          title: 'Multi-Genre Movie',
          genres: ['Action', 'Adventure', 'Sci-Fi', 'Thriller', 'Drama']
        }
      ];

      const formatted = server.formatRecentlyAdded(items);
      
      expect(formatted).toContain('Genres: Action, Adventure, Sci-Fi');
      expect(formatted).not.toContain('Thriller');
    });

    it('should truncate long summaries', () => {
      const longSummary = 'A'.repeat(150);
      const items = [
        {
          title: 'Long Summary Movie',
          summary: longSummary
        }
      ];

      const formatted = server.formatRecentlyAdded(items);
      
      expect(formatted).toContain('...');
      expect(formatted.includes(longSummary)).toBe(false);
    });
  });
});