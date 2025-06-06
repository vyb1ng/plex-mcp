const PlexMCPServer = require('../../index.js');
const { 
  mockSearchResponse, 
  mockLibrariesResponse, 
  mockPlaylistsResponse,
  mockWatchHistoryResponse,
  mockOnDeckResponse,
  mockEmptyResponse 
} = require('../fixtures/plex-responses.js');

describe('Parser Functions', () => {
  let server;

  beforeEach(() => {
    server = new PlexMCPServer();
  });

  describe('parseSearchResults', () => {
    it('should parse search results correctly', () => {
      const results = server.parseSearchResults(mockSearchResponse);
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: 'Test Movie',
        type: 'movie',
        year: 2023,
        summary: 'A test movie for unit testing',
        rating: 8.5,
        duration: 7200000,
        addedAt: 1703097600,
        viewCount: 1,
        lastViewedAt: 1703184000,
        contentRating: undefined,
        Media: undefined,
        key: '/library/metadata/12345',
        ratingKey: '12345',
        // Additional hierarchical info for music tracks
        parentTitle: undefined,
        grandparentTitle: undefined,
        parentRatingKey: undefined,
        grandparentRatingKey: undefined,
        // Additional metadata for basic filters
        studio: undefined,
        genres: [],
        directors: [],
        writers: [],
        actors: []
      });
    });

    it('should handle empty search results', () => {
      const results = server.parseSearchResults(mockEmptyResponse);
      expect(results).toEqual([]);
    });

    it('should handle missing MediaContainer', () => {
      const results = server.parseSearchResults({});
      expect(results).toEqual([]);
    });

    it('should handle missing Metadata', () => {
      const results = server.parseSearchResults({ MediaContainer: {} });
      expect(results).toEqual([]);
    });
  });

  describe('parseLibraries', () => {
    it('should parse libraries correctly', () => {
      const libraries = server.parseLibraries(mockLibrariesResponse);
      
      expect(libraries).toHaveLength(3);
      expect(libraries[0]).toEqual({
        key: '1',
        title: 'Movies',
        type: 'movie',
        agent: 'com.plexapp.agents.themoviedb',
        scanner: 'Plex Movie Scanner',
        language: 'en',
        refreshing: undefined,
        createdAt: 1703097600,
        updatedAt: 1703184000,
        scannedAt: 1703270400
      });
    });

    it('should handle empty library response', () => {
      const libraries = server.parseLibraries({ MediaContainer: {} });
      expect(libraries).toEqual([]);
    });
  });

  describe('parsePlaylists', () => {
    it('should parse playlists correctly', () => {
      const playlists = server.parsePlaylists(mockPlaylistsResponse);
      
      expect(playlists).toHaveLength(2);
      expect(playlists[0]).toEqual({
        ratingKey: 'pl001',
        key: '/playlists/pl001',
        title: 'My Music Playlist',
        type: 'playlist',
        playlistType: 'audio',
        smart: false,
        duration: 3600000,
        leafCount: 15,
        addedAt: 1703097600,
        updatedAt: 1703184000,
        composite: undefined
      });
    });

    it('should identify smart playlists', () => {
      const playlists = server.parsePlaylists(mockPlaylistsResponse);
      expect(playlists[1].smart).toBe(true);
    });
  });

  describe('parseWatchHistory', () => {
    it('should parse watch history correctly', () => {
      const history = server.parseWatchHistory(mockWatchHistoryResponse);
      
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        title: 'Test Movie',
        type: 'movie',
        year: 2023,
        viewedAt: 1703184000,
        accountID: 1,
        deviceID: 'test-device-123',
        viewOffset: 7200000,
        duration: 7200000,
        grandparentTitle: undefined,
        parentTitle: undefined,
        index: undefined,
        parentIndex: undefined,
        key: undefined
      });
    });

    it('should handle TV show episodes in history', () => {
      const history = server.parseWatchHistory(mockWatchHistoryResponse);
      expect(history[1].grandparentTitle).toBe('Test TV Show');
      expect(history[1].parentIndex).toBe(1);
      expect(history[1].index).toBe(1);
    });
  });

  describe('parseOnDeck', () => {
    it('should parse on deck items correctly', () => {
      const onDeck = server.parseOnDeck(mockOnDeckResponse);
      
      expect(onDeck).toHaveLength(1);
      expect(onDeck[0]).toEqual({
        title: 'Episode Title',
        type: 'episode',
        year: undefined,
        viewOffset: 900000,
        duration: 2700000,
        lastViewedAt: 1703270400,
        grandparentTitle: 'Test TV Show',
        parentTitle: 'Season 1',
        index: 2,
        parentIndex: 1,
        summary: 'Continue watching this episode',
        rating: undefined,
        key: undefined
      });
    });
  });

  describe('parseWatchedStatus', () => {
    it('should parse watched status for fully watched item', () => {
      const item = {
        ratingKey: '12345',
        title: 'Test Movie',
        type: 'movie',
        year: 2023,
        viewCount: 2,
        lastViewedAt: 1703184000,
        duration: 7200000
      };
      
      const status = server.parseWatchedStatus(item);
      
      expect(status).toEqual({
        ratingKey: '12345',
        title: 'Test Movie',
        type: 'movie',
        year: 2023,
        viewCount: 2,
        lastViewedAt: 1703184000,
        viewOffset: 0,
        duration: 7200000,
        watched: true,
        partiallyWatched: false,
        grandparentTitle: undefined,
        parentTitle: undefined,
        index: undefined,
        parentIndex: undefined
      });
    });

    it('should parse watched status for partially watched item', () => {
      const item = {
        ratingKey: '67890',
        title: 'Episode Title',
        type: 'episode',
        viewOffset: 1350000,
        duration: 2700000,
        viewCount: 0
      };
      
      const status = server.parseWatchedStatus(item);
      
      expect(status.watched).toBe(false);
      expect(status.partiallyWatched).toBe(true);
      expect(status.viewOffset).toBe(1350000);
    });

    it('should parse watched status for unwatched item', () => {
      const item = {
        ratingKey: '99999',
        title: 'Unwatched Movie',
        type: 'movie',
        duration: 7200000
      };
      
      const status = server.parseWatchedStatus(item);
      
      expect(status.watched).toBe(false);
      expect(status.partiallyWatched).toBe(false);
      expect(status.viewCount).toBe(0);
      expect(status.viewOffset).toBe(0);
    });
  });

  describe('parseLibraryContent', () => {
    it('should parse library content with additional fields', () => {
      const content = server.parseLibraryContent(mockSearchResponse);
      
      expect(content).toHaveLength(2);
      expect(content[0]).toHaveProperty('title', 'Test Movie');
      expect(content[0]).toHaveProperty('genres');
      expect(content[0]).toHaveProperty('viewCount');
      expect(content[0]).toHaveProperty('originallyAvailableAt');
    });
  });

  describe('getPlexTypeNumber', () => {
    it('should return correct type numbers', () => {
      expect(server.getPlexTypeNumber('movie')).toBe(1);
      expect(server.getPlexTypeNumber('show')).toBe(2);
      expect(server.getPlexTypeNumber('episode')).toBe(4);
      expect(server.getPlexTypeNumber('artist')).toBe(8);
      expect(server.getPlexTypeNumber('album')).toBe(9);
      expect(server.getPlexTypeNumber('track')).toBe(10);
    });

    it('should return null for unknown types', () => {
      expect(server.getPlexTypeNumber('unknown')).toBe(null);
      expect(server.getPlexTypeNumber('')).toBe(null);
      expect(server.getPlexTypeNumber(null)).toBe(null);
    });
  });
});