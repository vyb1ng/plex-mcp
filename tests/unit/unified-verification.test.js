const PlexMCPServer = require('../../index.js');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

describe('REQ-004: Unified Verification System Tests', () => {
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

  describe('verifyPlaylistOperation', () => {
    it('should verify "create" operation successfully', async () => {
      // Mock playlist exists and has expected items
      mock.onGet(/\/playlists\/123$/).reply(200, {
        MediaContainer: {
          Metadata: [{
            ratingKey: '123',
            title: 'Test Playlist',
            playlistType: 'audio',
            updatedAt: Date.now()
          }]
        }
      });
      mock.onGet(/\/playlists\/123\/items$/).reply(200, {
        MediaContainer: { totalSize: 1 }
      });

      const result = await server.verifyPlaylistOperation('create', '123', {
        expectedTotalItems: 1
      });

      expect(result.verified).toBe(true);
      expect(result.operationType).toBe('create');
      expect(result.finalState.exists).toBe(true);
      expect(result.finalState.title).toBe('Test Playlist');
      expect(result.finalState.itemCount).toBe(1);
    });

    it('should verify "add" operation with retry logic', async () => {
      // First attempt: no change yet
      mock.onGet(/\/playlists\/456$/).replyOnce(200, {
        MediaContainer: {
          Metadata: [{ ratingKey: '456', title: 'Add Test' }]
        }
      });
      mock.onGet(/\/playlists\/456\/items$/).replyOnce(200, {
        MediaContainer: { totalSize: 1 }
      });

      // Second attempt: items were added
      mock.onGet(/\/playlists\/456$/).replyOnce(200, {
        MediaContainer: {
          Metadata: [{ ratingKey: '456', title: 'Add Test' }]
        }
      });
      mock.onGet(/\/playlists\/456\/items$/).replyOnce(200, {
        MediaContainer: { totalSize: 3 }
      });

      const result = await server.verifyPlaylistOperation('add', '456', {
        expectedTotalItems: 3
      });

      expect(result.verified).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.changes.actualTotalItems).toBe(3);
    });

    it('should verify "delete" operation', async () => {
      // Playlist should return 404 after deletion
      mock.onGet(/\/playlists\/789$/).reply(404, 'Not Found');
      mock.onGet(/\/playlists\/789\/items$/).reply(404, 'Not Found');

      const result = await server.verifyPlaylistOperation('delete', '789');

      expect(result.verified).toBe(true);
      expect(result.finalState.exists).toBe(false);
    });

    it('should handle verification timeout and report failure', async () => {
      // Always return the same state, never reaching expected state
      mock.onGet(/\/playlists\/999$/).reply(200, {
        MediaContainer: {
          Metadata: [{ ratingKey: '999', title: 'Timeout Test' }]
        }
      });
      mock.onGet(/\/playlists\/999\/items$/).reply(200, {
        MediaContainer: { totalSize: 0 }
      });

      const result = await server.verifyPlaylistOperation('add', '999', {
        expectedTotalItems: 5
      }, {
        maxRetries: 2,
        baseDelay: 10 // Speed up test
      });

      expect(result.verified).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.changes.actualTotalItems).toBe(0);
    });
  });

  describe('generateOperationConfirmation', () => {
    it('should generate standardized confirmation for successful create', async () => {
      const mockVerificationResult = {
        operationType: 'create',
        playlistId: '123',
        verified: true,
        attempts: 1,
        finalState: {
          exists: true,
          title: 'My New Playlist',
          itemCount: 1
        },
        changes: { actualTotalItems: 1 },
        timings: { totalDuration: 250 },
        errors: []
      };

      const confirmation = server.generateOperationConfirmation(
        'create',
        mockVerificationResult,
        { title: 'My New Playlist' }
      );

      expect(confirmation.text).toContain('✅ SUCCESS: create operation on playlist "My New Playlist"');
      expect(confirmation.text).toContain('created successfully with 1 item(s)');
      expect(confirmation.text).toContain('Operation completed in 250ms');
      expect(confirmation.structured_data.verified).toBe(true);
      expect(confirmation.structured_data.operation_type).toBe('create');
    });

    it('should generate standardized confirmation for partial add success', async () => {
      const mockVerificationResult = {
        operationType: 'add',
        playlistId: '456',
        verified: false, // Partial success
        attempts: 3,
        finalState: {
          exists: true,
          title: 'Existing Playlist',
          itemCount: 12
        },
        changes: { actualTotalItems: 12 },
        timings: { totalDuration: 1500 },
        errors: []
      };

      const confirmation = server.generateOperationConfirmation(
        'add',
        mockVerificationResult,
        {
          attempted: 5,
          successfulAdds: 3,
          beforeCount: 10,
          failedAdds: ['item1', 'item2']
        }
      );

      expect(confirmation.text).toContain('⚠️ PARTIAL SUCCESS: add operation');
      expect(confirmation.text).toContain('Attempted: 5 item(s)');
      expect(confirmation.text).toContain('Successfully added: 2 item(s)');
      expect(confirmation.text).toContain('Failed: 2 item(s)');
      expect(confirmation.text).toContain('Verification attempts: 3');
      expect(confirmation.structured_data.verified).toBe(false);
    });

    it('should generate standardized confirmation for failed deletion', async () => {
      const mockVerificationResult = {
        operationType: 'delete',
        playlistId: '789',
        verified: false,
        attempts: 2,
        finalState: {
          exists: true, // Still exists, deletion failed
          title: 'Persistent Playlist'
        },
        changes: {},
        timings: { totalDuration: 500 },
        errors: [{ error: 'Permission denied', attempt: 2 }]
      };

      const confirmation = server.generateOperationConfirmation(
        'delete',
        mockVerificationResult,
        { playlistTitle: 'Persistent Playlist' }
      );

      expect(confirmation.text).toContain('❌ FAILURE: delete operation');
      expect(confirmation.text).toContain('deletion failed');
      expect(confirmation.text).toContain('Last error: Permission denied');
      expect(confirmation.structured_data.verified).toBe(false);
    });
  });

  describe('Integration with playlist operations', () => {
    it('should use unified verification in handleCreatePlaylist', async () => {
      // Mock all the required endpoints for smart playlist creation
      mock.onGet().reply(200, { MediaContainer: { machineIdentifier: 'test' } });
      mock.onPost().reply(200, {
        MediaContainer: {
          Metadata: [{
            ratingKey: '999',
            title: 'Smart Integration Test',
            playlistType: 'audio'
          }]
        }
      });
      mock.onGet(/\/playlists\/999$/).reply(200, {
        MediaContainer: {
          Metadata: [{
            ratingKey: '999',
            title: 'Smart Integration Test',
            playlistType: 'audio'
          }]
        }
      });
      mock.onGet(/\/playlists\/999\/items$/).reply(200, {
        MediaContainer: { totalSize: 0 }
      });

      const result = await server.handleCreatePlaylist({
        title: 'Smart Integration Test',
        type: 'audio',
        smart: true
      });

      expect(result.content[0].text).toContain('✅ SUCCESS: create operation');
      expect(result.content[0].text).toContain('Smart Integration Test');
      expect(result.content[0].text).toContain('Smart Playlist: Yes');
    });
  });
});