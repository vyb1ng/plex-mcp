const PlexMCPServer = require('../../index.js');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const {
  mockSearchResponse,
  mockLibrariesResponse,
  mockPlaylistsResponse,
  mockWatchHistoryResponse,
  mockOnDeckResponse,
  mockEmptyResponse,
  mockErrorResponse
} = require('../fixtures/plex-responses.js');

describe('Handler Integration Tests', () => {
  let server;
  let mockAxios;
  let axiosInstance;

  beforeEach(() => {
    axiosInstance = axios.create();
    mockAxios = new MockAdapter(axiosInstance);
    server = new PlexMCPServer({ axios: axiosInstance });
  });

  afterEach(() => {
    mockAxios.restore();
  });

  describe('handlePlexSearch', () => {
    it('should handle successful search', async() => {
      mockAxios.onGet().reply(200, mockSearchResponse);

      const result = await server.handlePlexSearch({
        query: 'test movie',
        limit: 10
      });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Found 2 results for "test movie"');
      expect(result.content[0].text).toContain('Test Movie');
    });

    it('should handle search with type filter', async() => {
      mockAxios.onGet().reply(200, mockSearchResponse);

      const result = await server.handlePlexSearch({
        query: 'test',
        type: 'movie',
        limit: 5
      });

      expect(result.content[0].text).toContain('Found 2 results');
    });

    it('should handle empty search results', async() => {
      mockAxios.onGet().reply(200, mockEmptyResponse);

      const result = await server.handlePlexSearch({
        query: 'nonexistent'
      });

      expect(result.content[0].text).toContain('Found 0 results');
    });

    it('should handle missing PLEX_TOKEN', async() => {
      const originalToken = process.env.PLEX_TOKEN;
      delete process.env.PLEX_TOKEN;
      mockAxios.onGet().reply(404, 'Not Found');

      const result = await server.handlePlexSearch({
        query: 'test'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection Failed');

      process.env.PLEX_TOKEN = originalToken;
    });

    it('should handle API errors', async() => {
      mockAxios.onGet().reply(401, mockErrorResponse);

      const result = await server.handlePlexSearch({
        query: 'test'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Authentication Required');
    });
  });

  describe('handleBrowseLibraries', () => {
    it('should handle successful library browsing', async() => {
      mockAxios.onGet().reply(200, mockLibrariesResponse);

      const result = await server.handleBrowseLibraries({});

      expect(result.content[0].text).toContain('Available Plex Libraries');
      expect(result.content[0].text).toContain('**Movies** (movie)');
      expect(result.content[0].text).toContain('**TV Shows** (show)');
      expect(result.content[0].text).toContain('**Music** (artist)');
    });

    it('should handle API errors', async() => {
      mockAxios.onGet().reply(500, { error: 'Server error' });

      const result = await server.handleBrowseLibraries({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection Failed');
    });
  });

  describe('handleBrowseLibrary', () => {
    it('should handle successful library content browsing', async() => {
      mockAxios.onGet().reply(200, mockSearchResponse);

      const result = await server.handleBrowseLibrary({
        library_id: '1',
        sort: 'titleSort',
        limit: 20
      });

      expect(result.content[0].text).toContain('Library content (1-2 of 2)');
      expect(result.content[0].text).toContain('Test Movie');
    });

    it('should handle browsing with filters', async() => {
      mockAxios.onGet().reply(200, mockSearchResponse);

      const result = await server.handleBrowseLibrary({
        library_id: '1',
        genre: 'Action',
        year: 2023,
        sort: 'addedAt'
      });

      expect(result.content[0].text).toContain('Genre: Action');
      expect(result.content[0].text).toContain('Year: 2023');
      expect(result.content[0].text).toContain('Sorted by: addedAt');
    });
  });

  describe('handleRecentlyAdded', () => {
    it('should handle recently added for all libraries', async() => {
      mockAxios.onGet().reply(200, mockSearchResponse);

      const result = await server.handleRecentlyAdded({
        limit: 15
      });

      expect(result.content[0].text).toContain('Recently added content');
      expect(result.content[0].text).toContain('(showing 1-2 of 2 items)');
    });

    it('should handle recently added for specific library', async() => {
      mockAxios.onGet().reply(200, mockSearchResponse);

      const result = await server.handleRecentlyAdded({
        library_id: '1',
        limit: 10
      });

      expect(result.content[0].text).toContain('Recently added content from library 1');
    });
  });

  describe('handleWatchHistory', () => {
    it('should handle watch history successfully', async() => {
      mockAxios.onGet().reply(200, mockWatchHistoryResponse);

      const result = await server.handleWatchHistory({
        limit: 20
      });

      expect(result.content[0].text).toContain('Watch history (showing 1-2 of 2 items)');
      expect(result.content[0].text).toContain('Test Movie');
      expect(result.content[0].text).toContain('Test TV Show');
    });

    it('should handle watch history for specific account', async() => {
      mockAxios.onGet().reply(200, mockWatchHistoryResponse);

      const result = await server.handleWatchHistory({
        account_id: '123',
        limit: 10
      });

      expect(result.content[0].text).toContain('Watch history for account 123');
    });
  });

  describe('handleOnDeck', () => {
    it('should handle on deck items successfully', async() => {
      mockAxios.onGet().reply(200, mockOnDeckResponse);

      const result = await server.handleOnDeck({
        limit: 15
      });

      expect(result.content[0].text).toContain('On Deck (Continue Watching) - 1 items');
      expect(result.content[0].text).toContain('Test TV Show');
      expect(result.content[0].text).toContain('Progress:');
    });
  });

  describe('handleListPlaylists', () => {
    it('should handle playlist listing successfully', async() => {
      mockAxios.onGet().reply(200, mockPlaylistsResponse);

      const result = await server.handleListPlaylists({});

      expect(result.content[0].text).toContain('Playlists - 2 found');
      expect(result.content[0].text).toContain('My Music Playlist');
      expect(result.content[0].text).toContain('Favorite Movies');
    });

    it('should handle playlist filtering by type', async() => {
      mockAxios.onGet().reply(200, mockPlaylistsResponse);

      const result = await server.handleListPlaylists({
        playlist_type: 'audio'
      });

      expect(result.content[0].text).toContain('Playlists (audio)');
    });
  });

  describe('handleCreatePlaylist', () => {
    it('should handle playlist creation successfully', async() => {
      const createResponse = {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 'new123',
              title: 'New Test Playlist'
            }
          ]
        }
      };
      mockAxios.onGet().reply(200, { MediaContainer: { machineIdentifier: 'test' } });
      mockAxios.onPost().reply(200, createResponse);

      const result = await server.handleCreatePlaylist({
        title: 'New Test Playlist',
        type: 'audio',
        item_key: '456'
      });

      expect(result.content[0].text).toContain('Successfully created playlist: **New Test Playlist**');
      expect(result.content[0].text).toContain('Playlist ID: new123');
      expect(result.content[0].text).toContain('Type: audio');
    });

    it.skip('should handle smart playlist creation (disabled feature)', async() => {
      mockAxios.onGet().reply(200, { MediaContainer: { machineIdentifier: 'test' } });
      mockAxios.onPost().reply(200, { MediaContainer: { Metadata: [{}] } });

      const result = await server.handleCreatePlaylist({
        title: 'Smart Playlist',
        type: 'video',
        smart: true
      });

      expect(result.content[0].text).toContain('Successfully created smart playlist');
    });
  });

  describe('handleAddToPlaylist', () => {
    it('should handle adding items to playlist', async() => {
      // Mock playlist info endpoint
      const mockPlaylistInfo = {
        MediaContainer: {
          Metadata: [{
            title: 'Test Playlist',
            ratingKey: 'pl123'
          }]
        }
      };

      // Mock playlist items endpoints (before and after)
      const mockPlaylistItemsBefore = {
        MediaContainer: {
          totalSize: 2,
          Metadata: [{ title: 'Item 1' }, { title: 'Item 2' }] // 2 existing items
        }
      };

      const mockPlaylistItemsAfter = {
        MediaContainer: {
          totalSize: 5,
          Metadata: [
            { title: 'Item 1' },
            { title: 'Item 2' },
            { title: 'Item 3' },
            { title: 'Item 4' },
            { title: 'Item 5' }
          ] // 5 items after adding 3
        }
      };

      // Mock server info endpoint for machine identifier
      const mockServerInfo = {
        MediaContainer: {
          machineIdentifier: 'test-machine-123'
        }
      };

      mockAxios.onGet(new RegExp('/$')).reply(200, mockServerInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123$')).reply(200, mockPlaylistInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123/items')).replyOnce(200, mockPlaylistItemsBefore);
      mockAxios.onPut().reply(200, {});
      mockAxios.onGet(new RegExp('/playlists/pl123/items')).replyOnce(200, mockPlaylistItemsAfter);

      const result = await server.handleAddToPlaylist({
        playlist_id: 'pl123',
        item_keys: ['item1', 'item2', 'item3']
      });

      expect(result.content[0].text).toContain('Attempted to add: 3 item(s)');
      expect(result.content[0].text).toContain('Actually added: 3 item(s)');
      expect(result.content[0].text).toContain('All items added successfully');
    });

    it('should handle adding duplicate items (successful API call, no count change)', async() => {
      // Mock playlist info endpoint
      const mockPlaylistInfo = {
        MediaContainer: {
          Metadata: [{
            title: 'Test Playlist',
            ratingKey: 'pl123'
          }]
        }
      };

      // Mock playlist items endpoints (same count before and after - duplicates)
      const mockPlaylistItems = {
        MediaContainer: {
          totalSize: 2,
          Metadata: [{ title: 'Item 1' }, { title: 'Item 2' }] // Same count
        }
      };

      // Mock server info endpoint for machine identifier
      const mockServerInfo = {
        MediaContainer: {
          machineIdentifier: 'test-machine-123'
        }
      };

      mockAxios.onGet(new RegExp('/$')).reply(200, mockServerInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123$')).reply(200, mockPlaylistInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123/items')).reply(200, mockPlaylistItems);
      mockAxios.onPut().reply(200, {}); // Successful HTTP response

      const result = await server.handleAddToPlaylist({
        playlist_id: 'pl123',
        item_keys: ['item1', 'item2'] // These are duplicates
      });

      expect(result.content[0].text).toContain('Attempted to add: 2 item(s)');
      expect(result.content[0].text).toContain('Actually added: 0 item(s)');
      expect(result.content[0].text).toContain('API request successful!');
      expect(result.content[0].text).toContain('duplicates');
    });
  });

  describe('handleRemoveFromPlaylist', () => {
    it('should handle removing items from playlist', async() => {
      // Mock playlist info endpoint
      const mockPlaylistInfo = {
        MediaContainer: {
          Metadata: [{
            title: 'Test Playlist',
            ratingKey: 'pl123'
          }]
        }
      };

      // Mock playlist items endpoints (before and after)
      const mockPlaylistItemsBefore = {
        MediaContainer: {
          totalSize: 3,
          Metadata: [
            { title: 'Item 1', ratingKey: 'item1' },
            { title: 'Item 2', ratingKey: 'item2' },
            { title: 'Item 3', ratingKey: 'item3' }
          ] // 3 existing items
        }
      };

      const mockPlaylistItemsAfter = {
        MediaContainer: {
          totalSize: 1,
          Metadata: [{ title: 'Item 3', ratingKey: 'item3' }] // 1 item after removing 2
        }
      };

      // Mock server info endpoint for machine identifier
      const mockServerInfo = {
        MediaContainer: {
          machineIdentifier: 'test-machine-123'
        }
      };

      mockAxios.onGet(new RegExp('/$')).reply(200, mockServerInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123$')).reply(200, mockPlaylistInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123/items')).replyOnce(200, mockPlaylistItemsBefore);
      mockAxios.onDelete().reply(200, {});
      mockAxios.onGet(new RegExp('/playlists/pl123/items')).replyOnce(200, mockPlaylistItemsAfter);

      const result = await server.handleRemoveFromPlaylist({
        playlist_id: 'pl123',
        item_keys: ['item1', 'item2']
      });

      expect(result.content[0].text).toContain('Attempted to remove: 2 item(s)');
      expect(result.content[0].text).toContain('Actually removed: 2 item(s)');
      expect(result.content[0].text).toContain('All items removed successfully');
    });

    it('should handle removing non-existent items (successful API call, no count change)', async() => {
      // Mock playlist info endpoint
      const mockPlaylistInfo = {
        MediaContainer: {
          Metadata: [{
            title: 'Test Playlist',
            ratingKey: 'pl123'
          }]
        }
      };

      // Mock playlist items endpoints (same count before and after - items don't exist)
      const mockPlaylistItems = {
        MediaContainer: {
          totalSize: 3,
          Metadata: [
            { title: 'Item 1', ratingKey: 'item1' },
            { title: 'Item 2', ratingKey: 'item2' },
            { title: 'Item 3', ratingKey: 'item3' }
          ] // Items with different keys than what we're trying to remove (item999, item888)
        }
      };

      // Mock server info endpoint for machine identifier
      const mockServerInfo = {
        MediaContainer: {
          machineIdentifier: 'test-machine-123'
        }
      };

      mockAxios.onGet(new RegExp('/$')).reply(200, mockServerInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123$')).reply(200, mockPlaylistInfo);
      mockAxios.onGet(new RegExp('/playlists/pl123/items')).reply(200, mockPlaylistItems);
      mockAxios.onDelete().reply(200, {}); // Successful HTTP response

      const result = await server.handleRemoveFromPlaylist({
        playlist_id: 'pl123',
        item_keys: ['item999', 'item888'] // These don't exist in playlist
      });

      expect(result.content[0].text).toContain('No matching items found in playlist');
      expect(result.content[0].text).toContain('Specified items may not exist in this playlist');
    });
  });

  describe('handleDeletePlaylist', () => {
    it('should handle playlist deletion', async() => {
      mockAxios.onDelete().reply(200, {});

      const result = await server.handleDeletePlaylist({
        playlist_id: 'pl123'
      });

      expect(result.content[0].text).toContain('Successfully deleted playlist pl123');
    });
  });

  describe('handleWatchedStatus', () => {
    it('should handle single item status check', async() => {
      const statusResponse = {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '12345',
              title: 'Test Movie',
              type: 'movie',
              year: 2023,
              viewCount: 1,
              lastViewedAt: 1703184000,
              duration: 7200000
            }
          ]
        }
      };
      mockAxios.onGet().reply(200, statusResponse);

      const result = await server.handleWatchedStatus({
        item_keys: ['12345']
      });

      expect(result.content[0].text).toContain('Watch status for 1 item(s)');
      expect(result.content[0].text).toContain('Test Movie');
      expect(result.content[0].text).toContain('Status: ✅ Watched');
    });

    it('should handle multiple items with mixed status', async() => {
      let callCount = 0;
      mockAxios.onGet().reply(() => {
        callCount++;
        if (callCount === 1) {
          return [200, {
            MediaContainer: {
              Metadata: [{
                ratingKey: '12345',
                title: 'Watched Movie',
                viewCount: 1,
                duration: 7200000
              }]
            }
          }];
        } else {
          return [200, {
            MediaContainer: {
              Metadata: [{
                ratingKey: '67890',
                title: 'Partial Movie',
                viewCount: 0,
                viewOffset: 3600000,
                duration: 7200000
              }]
            }
          }];
        }
      });

      const result = await server.handleWatchedStatus({
        item_keys: ['12345', '67890']
      });

      expect(result.content[0].text).toContain('Watch status for 2 item(s)');
      expect(result.content[0].text).toContain('Status: ✅ Watched');
      expect(result.content[0].text).toContain('Status: ⏸️ In Progress');
    });

    it('should handle items not found', async() => {
      mockAxios.onGet().reply(404, { error: 'Not found' });

      const result = await server.handleWatchedStatus({
        item_keys: ['invalid123']
      });

      expect(result.content[0].text).toContain('Error: Request failed with status code 404');
    });
  });

  describe('Activity Filter Integration', () => {
    it('should handle search with activity filters', async() => {
      const responseWithActivity = {
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              title: 'Popular Track',
              type: 'track',
              year: 2023,
              summary: 'A popular test track',
              rating: 8.5,
              duration: 180000,
              addedAt: 1703097600,
              viewCount: 10,
              lastViewedAt: Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60) // 5 days ago
            }
          ]
        }
      };

      mockAxios.onGet().reply(200, responseWithActivity);

      const result = await server.handlePlexSearch({
        query: 'test',
        play_count_min: 5,
        played_in_last_days: 7
      });

      expect(result.content[0].text).toContain('Found 1 results');
      expect(result.content[0].text).toContain('Popular Track');
    });

    it('should filter out items that do not match activity criteria', async() => {
      const responseWithMixedActivity = {
        MediaContainer: {
          totalSize: 2,
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              title: 'Popular Track',
              type: 'track',
              year: 2023,
              summary: 'A popular test track',
              rating: 8.5,
              duration: 180000,
              addedAt: 1703097600,
              viewCount: 10,
              lastViewedAt: Math.floor(Date.now() / 1000) - (2 * 24 * 60 * 60)
            },
            {
              ratingKey: '67890',
              key: '/library/metadata/67890',
              title: 'Unpopular Track',
              type: 'track',
              year: 2022,
              summary: 'An unpopular test track',
              rating: 6.0,
              duration: 200000,
              addedAt: 1703097600,
              viewCount: 1,
              lastViewedAt: Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60)
            }
          ]
        }
      };

      mockAxios.onGet().reply(200, responseWithMixedActivity);

      const result = await server.handlePlexSearch({
        query: 'test',
        play_count_min: 5
      });

      expect(result.content[0].text).toContain('Found 1 results');
      expect(result.content[0].text).toContain('Popular Track');
      expect(result.content[0].text).not.toContain('Unpopular Track');
    });

    it('should handle browse library with activity filters', async() => {
      const responseWithActivity = {
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              title: 'Never Played Album',
              type: 'album',
              year: 2023,
              summary: 'A never played test album',
              rating: 7.0,
              duration: 3600000,
              addedAt: 1703097600,
              viewCount: 0,
              Genre: []
            }
          ]
        }
      };

      mockAxios.onGet().reply(200, responseWithActivity);

      const result = await server.handleBrowseLibrary({
        library_id: '3',
        never_played: true
      });

      expect(result.content[0].text).toContain('Never Played Album');
    });

    it('should handle date-based activity filters', async() => {
      const responseWithDates = {
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              title: 'Recent Track',
              type: 'track',
              year: 2023,
              summary: 'A recently played track',
              rating: 8.0,
              duration: 240000,
              addedAt: 1703097600,
              viewCount: 3,
              lastViewedAt: Math.floor(new Date('2023-12-22').getTime() / 1000),
              Genre: []
            }
          ]
        }
      };

      mockAxios.onGet().reply(200, responseWithDates);

      const result = await server.handleBrowseLibrary({
        library_id: '3',
        last_played_after: '2023-12-21'
      });

      expect(result.content[0].text).toContain('Recent Track');
    });

    it('should return empty results when no items match activity filters', async() => {
      const responseWithNoMatches = {
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: '12345',
              key: '/library/metadata/12345',
              title: 'Low Play Count Track',
              type: 'track',
              year: 2023,
              summary: 'A track with low play count',
              rating: 6.0,
              duration: 180000,
              addedAt: 1703097600,
              viewCount: 1
            }
          ]
        }
      };

      mockAxios.onGet().reply(200, responseWithNoMatches);

      const result = await server.handlePlexSearch({
        query: 'test',
        play_count_min: 10
      });

      expect(result.content[0].text).toContain('Found 0 results');
    });
  });

  describe('Network error handling', () => {
    it('should handle network timeouts', async() => {
      mockAxios.onGet().timeout();

      const result = await server.handlePlexSearch({
        query: 'test'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection Failed');
    });

    it('should handle connection refused', async() => {
      mockAxios.onGet().networkError();

      const result = await server.handleBrowseLibraries({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection Failed');
    });
  });
});
