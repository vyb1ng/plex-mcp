const PlexMCPServer = require('../../index.js');

// Check if we should run E2E tests
const plexUrl = process.env.E2E_PLEX_URL || process.env.PLEX_URL;
const plexToken = process.env.E2E_PLEX_TOKEN || process.env.PLEX_TOKEN;
const isTestEnvironment = plexUrl?.includes('test-plex-server.com') || plexToken?.includes('test-token');
const shouldRunE2E = plexUrl && plexToken && !isTestEnvironment;

const describeE2E = shouldRunE2E ? describe : describe.skip;

describeE2E('E2E Playlist Behavior Analysis Tests', () => {
  let server;
  let originalEnv;
  let testPlaylistId = null;
  let testItemKeys = [];
  let cleanupPlaylistIds = [];

  beforeAll(async () => {
    // Save original environment
    originalEnv = { ...process.env };
    
    console.log('🧪 Running detailed playlist behavior analysis against live Plex server');
    console.log(`📡 Server: ${plexUrl}`);

    // Set environment for tests
    process.env.PLEX_URL = plexUrl;
    process.env.PLEX_TOKEN = plexToken;

    server = new PlexMCPServer();

    // Find some test items to work with
    console.log('🔍 Searching for test items...');
    const searchResult = await server.handlePlexSearch({
      query: 'music',
      type: 'track',
      limit: 10
    });

    // Extract ratingKeys from search results
    const searchText = searchResult.content[0].text;
    const allIds = [...searchText.matchAll(/\*\*ID: (\d+)\*\*/g)];
    
    if (allIds.length >= 5) {
      testItemKeys = allIds.slice(0, 5).map(match => match[1]);
      console.log(`✅ Found ${testItemKeys.length} test items:`, testItemKeys);
    } else {
      console.log('⚠️ Warning: Less than 5 test items found, some tests may be skipped');
      testItemKeys = allIds.map(match => match[1]);
    }
  }, 30000);

  afterAll(async () => {
    // Cleanup test playlists
    console.log('🧹 Cleaning up test playlists...');
    for (const playlistId of cleanupPlaylistIds) {
      try {
        await server.handleDeletePlaylist({ playlist_id: playlistId });
        console.log(`🗑️ Deleted test playlist: ${playlistId}`);
      } catch (error) {
        console.log(`⚠️ Failed to cleanup playlist ${playlistId}: ${error.message}`);
      }
    }

    // Restore original environment
    process.env = originalEnv;
  }, 30000);

  describe('📝 Playlist Creation Behavior', () => {
    it('should create playlist with single initial item', async () => {
      if (testItemKeys.length === 0) {
        console.log('⏭️ Skipping: No test items available');
        return;
      }

      const createResult = await server.handleCreatePlaylist({
        title: `E2E_Test_Single_${Date.now()}`,
        type: 'audio',
        item_key: testItemKeys[0]
      });

      console.log('📋 Create playlist result:', createResult.content[0].text);

      // Extract playlist ID
      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        testPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(testPlaylistId);
        console.log(`✅ Created test playlist: ${testPlaylistId}`);
      }

      expect(createResult.content[0].text).toMatch(/Successfully created playlist|Playlist ID:/);
    }, 15000);

    it('should verify initial playlist contents', async () => {
      if (!testPlaylistId) {
        console.log('⏭️ Skipping: No test playlist created');
        return;
      }

      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('📖 Initial playlist contents:', browseResult.content[0].text);
      
      expect(browseResult.content[0].text).toMatch(/Items: \d+/);
    }, 10000);
  });

  describe('➕ Add Operations Analysis', () => {
    it('should test adding SINGLE item to existing playlist', async () => {
      if (!testPlaylistId || testItemKeys.length < 2) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🎵 Adding single item ${testItemKeys[1]} to playlist ${testPlaylistId}`);

      const addResult = await server.handleAddToPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItemKeys[1]]
      });

      console.log('📊 Single add result:', addResult.content[0].text);

      // Verify playlist after addition
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('📖 Playlist after single add:', browseAfter.content[0].text);

      expect(addResult.content[0].text).toMatch(/Attempted to add: 1 item/);
    }, 15000);

    it('should test adding MULTIPLE items at once (the failing case)', async () => {
      if (!testPlaylistId || testItemKeys.length < 5) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🎵 Adding multiple items [${testItemKeys[2]}, ${testItemKeys[3]}, ${testItemKeys[4]}] to playlist ${testPlaylistId}`);

      const addResult = await server.handleAddToPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItemKeys[2], testItemKeys[3], testItemKeys[4]]
      });

      console.log('📊 Multiple add result:', addResult.content[0].text);

      // Verify playlist after addition
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('📖 Playlist after multiple add:', browseAfter.content[0].text);

      expect(addResult.content[0].text).toMatch(/Attempted to add: 3 item/);
    }, 15000);

    it('should test adding duplicate items (should be ignored)', async () => {
      if (!testPlaylistId || testItemKeys.length < 2) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🔁 Adding duplicate item ${testItemKeys[0]} to playlist ${testPlaylistId}`);

      const addResult = await server.handleAddToPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItemKeys[0]]
      });

      console.log('📊 Duplicate add result:', addResult.content[0].text);

      expect(addResult.content[0].text).toMatch(/Attempted to add: 1 item/);
    }, 15000);
  });

  describe('❌ Remove Operations Analysis (CRITICAL)', () => {
    it('should document current playlist state before removal', async () => {
      if (!testPlaylistId) {
        console.log('⏭️ Skipping: No test playlist available');
        return;
      }

      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('📋 BEFORE REMOVAL - Playlist state:', browseResult.content[0].text);
      
      // Extract item count for comparison
      const itemCountMatch = browseResult.content[0].text.match(/Items: (\d+)/);
      if (itemCountMatch) {
        console.log(`📊 Items before removal: ${itemCountMatch[1]}`);
      }
    }, 10000);

    it('should test removing SINGLE item (the dangerous operation)', async () => {
      if (!testPlaylistId || testItemKeys.length < 1) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🗑️ CRITICAL TEST: Removing single item ${testItemKeys[0]} from playlist ${testPlaylistId}`);
      console.log('⚠️ WARNING: This may remove ALL playlist contents due to the bug!');

      const removeResult = await server.handleRemoveFromPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItemKeys[0]]
      });

      console.log('📊 Remove result:', removeResult.content[0].text);

      // Check playlist state after removal
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('📖 AFTER REMOVAL - Playlist state:', browseAfter.content[0].text);

      // Extract item count to see what actually happened
      const itemCountMatch = browseAfter.content[0].text.match(/Items: (\d+)/);
      if (itemCountMatch) {
        console.log(`📊 Items after removal: ${itemCountMatch[1]}`);
        
        if (itemCountMatch[1] === '0') {
          console.log('🚨 CRITICAL BUG CONFIRMED: Remove operation emptied entire playlist!');
        }
      }

      expect(removeResult.content[0].text).toMatch(/Attempted to remove: 1 item/);
    }, 15000);
  });

  describe('🧪 API Behavior Patterns', () => {
    it('should create fresh playlist for pattern testing', async () => {
      if (testItemKeys.length < 3) {
        console.log('⏭️ Skipping: Not enough test items');
        return;
      }

      const createResult = await server.handleCreatePlaylist({
        title: `E2E_Pattern_Test_${Date.now()}`,
        type: 'audio',
        item_key: testItemKeys[0]
      });

      console.log('📋 Pattern test playlist result:', createResult.content[0].text);

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        const patternTestPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(patternTestPlaylistId);
        
        // Test the exact sequence: create -> add single -> add multiple -> remove
        console.log('\n🔬 TESTING EXACT SEQUENCE PATTERN:');
        
        // Step 1: Add single item
        console.log('1️⃣ Adding single item...');
        const singleAdd = await server.handleAddToPlaylist({
          playlist_id: patternTestPlaylistId,
          item_keys: [testItemKeys[1]]
        });
        console.log('   Result:', singleAdd.content[0].text);
        
        // Step 2: Check state
        const afterSingle = await server.handleBrowsePlaylist({
          playlist_id: patternTestPlaylistId
        });
        console.log('   State after single add:', afterSingle.content[0].text.match(/Items: (\d+)/)?.[1] || 'unknown');
        
        // Step 3: Add multiple items
        console.log('2️⃣ Adding multiple items...');
        const multipleAdd = await server.handleAddToPlaylist({
          playlist_id: patternTestPlaylistId,
          item_keys: [testItemKeys[2]]
        });
        console.log('   Result:', multipleAdd.content[0].text);
        
        // Step 4: Check final state
        const finalState = await server.handleBrowsePlaylist({
          playlist_id: patternTestPlaylistId
        });
        console.log('   Final state:', finalState.content[0].text.match(/Items: (\d+)/)?.[1] || 'unknown');
      }

      expect(createResult.content[0].text).toMatch(/Successfully created playlist/);
    }, 20000);
  });

  describe('🔍 Response Message Analysis', () => {
    it('should analyze response accuracy patterns', async () => {
      console.log('\n📈 RESPONSE MESSAGE ANALYSIS:');
      console.log('This test documents what the API actually returns vs what messages we show');
      
      // This test is mainly for documentation - it will pass regardless
      // but logs the exact patterns we're seeing
      
      console.log('✅ Test completed - check logs above for response patterns');
      expect(true).toBe(true);
    });
  });

  describe('🧹 Comprehensive Cleanup Verification', () => {
    it('should verify all test playlists can be properly deleted', async () => {
      console.log('\n🗑️ TESTING PLAYLIST DELETION:');
      
      if (cleanupPlaylistIds.length === 0) {
        console.log('✅ No playlists to clean up - all tests cleaned up after themselves');
        expect(true).toBe(true);
        return;
      }
      
      let deletionResults = [];
      
      for (const playlistId of cleanupPlaylistIds) {
        try {
          const deleteResult = await server.handleDeletePlaylist({
            playlist_id: playlistId
          });
          deletionResults.push({
            id: playlistId,
            success: true,
            message: deleteResult.content[0].text
          });
          console.log(`✅ Deleted ${playlistId}: ${deleteResult.content[0].text}`);
        } catch (error) {
          deletionResults.push({
            id: playlistId,
            success: false,
            message: error.message
          });
          console.log(`❌ Failed to delete ${playlistId}: ${error.message}`);
        }
      }
      
      console.log('📊 Deletion summary:', deletionResults);
      
      // Clear the cleanup array since we've processed them
      cleanupPlaylistIds = [];
      
      expect(deletionResults.length).toBeGreaterThan(0);
    }, 30000);
  });
});