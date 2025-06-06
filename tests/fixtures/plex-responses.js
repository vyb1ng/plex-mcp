// Mock Plex API responses for testing

const mockSearchResponse = {
  MediaContainer: {
    totalSize: 2,
    Metadata: [
      {
        ratingKey: '12345',
        key: '/library/metadata/12345',
        title: 'Test Movie',
        type: 'movie',
        year: 2023,
        summary: 'A test movie for unit testing',
        rating: 8.5,
        duration: 7200000, // 2 hours in milliseconds
        addedAt: 1703097600, // 2023-12-20
        viewCount: 1,
        lastViewedAt: 1703184000 // 2023-12-21
      },
      {
        ratingKey: '67890',
        key: '/library/metadata/67890',
        title: 'Test Episode',
        type: 'episode',
        year: 2023,
        grandparentTitle: 'Test TV Show',
        parentTitle: 'Season 1',
        index: 1,
        parentIndex: 1,
        summary: 'First episode of test show',
        duration: 2700000, // 45 minutes
        addedAt: 1703097600,
        viewOffset: 1350000 // 22.5 minutes watched
      }
    ]
  }
};

const mockLibrariesResponse = {
  MediaContainer: {
    Directory: [
      {
        key: '1',
        title: 'Movies',
        type: 'movie',
        agent: 'com.plexapp.agents.themoviedb',
        scanner: 'Plex Movie Scanner',
        language: 'en',
        createdAt: 1703097600,
        updatedAt: 1703184000,
        scannedAt: 1703270400
      },
      {
        key: '2',
        title: 'TV Shows',
        type: 'show',
        agent: 'com.plexapp.agents.thetvdb',
        scanner: 'Plex Series Scanner',
        language: 'en',
        createdAt: 1703097600,
        updatedAt: 1703184000,
        scannedAt: 1703270400
      },
      {
        key: '3',
        title: 'Music',
        type: 'artist',
        agent: 'com.plexapp.agents.lastfm',
        scanner: 'Plex Music Scanner',
        language: 'en',
        createdAt: 1703097600,
        updatedAt: 1703184000,
        scannedAt: 1703270400
      }
    ]
  }
};

const mockPlaylistsResponse = {
  MediaContainer: {
    Metadata: [
      {
        ratingKey: 'pl001',
        key: '/playlists/pl001',
        title: 'My Music Playlist',
        type: 'playlist',
        playlistType: 'audio',
        smart: false,
        duration: 3600000, // 1 hour
        leafCount: 15,
        addedAt: 1703097600,
        updatedAt: 1703184000
      },
      {
        ratingKey: 'pl002',
        key: '/playlists/pl002',
        title: 'Favorite Movies',
        type: 'playlist',
        playlistType: 'video',
        smart: true,
        leafCount: 25,
        addedAt: 1703097600,
        updatedAt: 1703184000
      }
    ]
  }
};

const mockWatchHistoryResponse = {
  MediaContainer: {
    Metadata: [
      {
        ratingKey: '12345',
        title: 'Test Movie',
        type: 'movie',
        year: 2023,
        viewedAt: 1703184000,
        accountID: 1,
        deviceID: 'test-device-123',
        viewOffset: 7200000, // Watched to end
        duration: 7200000
      },
      {
        ratingKey: '67890',
        title: 'Episode Title',
        type: 'episode',
        grandparentTitle: 'Test TV Show',
        parentTitle: 'Season 1',
        index: 1,
        parentIndex: 1,
        viewedAt: 1703270400,
        accountID: 1,
        deviceID: 'test-device-456',
        viewOffset: 1350000, // Partially watched
        duration: 2700000
      }
    ]
  }
};

const mockOnDeckResponse = {
  MediaContainer: {
    Metadata: [
      {
        ratingKey: '67890',
        title: 'Episode Title',
        type: 'episode',
        grandparentTitle: 'Test TV Show',
        parentTitle: 'Season 1',
        index: 2,
        parentIndex: 1,
        summary: 'Continue watching this episode',
        viewOffset: 900000, // 15 minutes watched
        duration: 2700000, // 45 minutes total
        lastViewedAt: 1703270400
      }
    ]
  }
};

const mockEmptyResponse = {
  MediaContainer: {
    totalSize: 0,
    Metadata: []
  }
};

const mockErrorResponse = {
  error: 'Unauthorized',
  message: 'Invalid token'
};

module.exports = {
  mockSearchResponse,
  mockLibrariesResponse,
  mockPlaylistsResponse,
  mockWatchHistoryResponse,
  mockOnDeckResponse,
  mockEmptyResponse,
  mockErrorResponse
};