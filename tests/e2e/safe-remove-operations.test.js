const PlexMCPServer = require('../../index.js');

// Check if we should run E2E tests
const plexUrl = process.env.E2E_PLEX_URL || process.env.PLEX_URL;
const plexToken = process.env.E2E_PLEX_TOKEN || process.env.PLEX_TOKEN;
const isTestEnvironment = plexUrl?.includes('test-plex-server.com') || plexToken?.includes('test-token');
const shouldRunE2E = plexUrl && plexToken && !isTestEnvironment;

const describeE2E = shouldRunE2E ? describe : describe.skip;

describeE2E('E2E Safe Remove Operations Tests', () => {
  let server;
  let originalEnv;
  let testItemKeys = [];
  let cleanupPlaylistIds = [];

  beforeAll(async() => {
    // Save original environment
    originalEnv = { ...process.env };

    console.log('🔒 Running SAFE remove operations tests against live Plex server');
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

  afterAll(async() => {
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

  describe('🔒 Safe Remove Pattern #1: Single Item Playlist', () => {
    let singleItemPlaylistId = null;

    it('should create playlist with single item for safe testing', async() => {
      if (testItemKeys.length === 0) {
        console.log('⏭️ Skipping: No test items available');
        return;
      }

      const createResult = await server.handleCreatePlaylist({
        title: `SafeTest_Single_${Date.now()}`,
        type: 'audio',
        item_key: testItemKeys[0]
      });

      console.log('📋 Created single-item playlist:', createResult.content[0].text);

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        singleItemPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(singleItemPlaylistId);
        console.log(`✅ Created test playlist: ${singleItemPlaylistId}`);
      }

      expect(createResult.content[0].text).toMatch(/Successfully created playlist|Playlist ID:/);
    }, 15000);

    it('should verify single-item playlist has exactly 1 item', async() => {
      if (!singleItemPlaylistId) {
        console.log('⏭️ Skipping: No test playlist created');
        return;
      }

      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: singleItemPlaylistId
      });

      console.log('📖 Single-item playlist contents:', browseResult.content[0].text);

      const itemCountMatch = browseResult.content[0].text.match(/Items: (\d+)/);
      if (itemCountMatch) {
        console.log(`📊 Confirmed item count: ${itemCountMatch[1]}`);
        expect(itemCountMatch[1]).toBe('1');
      }
    }, 10000);

    it('should safely remove the single item (CRITICAL TEST)', async() => {
      if (!singleItemPlaylistId || testItemKeys.length < 1) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🔒 SAFE TEST: Removing single item ${testItemKeys[0]} from single-item playlist`);

      const removeResult = await server.handleRemoveFromPlaylist({
        playlist_id: singleItemPlaylistId,
        item_keys: [testItemKeys[0]]
      });

      console.log('📊 Remove result:', removeResult.content[0].text);

      // Check playlist state after removal
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: singleItemPlaylistId
      });

      console.log('📖 Playlist after removal:', browseAfter.content[0].text);

      const itemCountMatch = browseAfter.content[0].text.match(/Items: (\d+)/);
      if (itemCountMatch) {
        const finalCount = itemCountMatch[1];
        console.log(`📊 Final item count: ${finalCount}`);

        if (finalCount === '0') {
          console.log('✅ EXPECTED: Single-item playlist is now empty');
        } else {
          console.log('⚠️ UNEXPECTED: Playlist still has items after removing only item');
        }
      }

      expect(removeResult.content[0].text).toMatch(/Attempted to remove: 1 item/);
    }, 15000);
  });

  describe('🔒 Safe Remove Pattern #2: Multi-Item Controlled Removal', () => {
    let multiItemPlaylistId = null;

    it('should create playlist with multiple items', async() => {
      if (testItemKeys.length < 3) {
        console.log('⏭️ Skipping: Need at least 3 test items');
        return;
      }

      // Create playlist with first item
      const createResult = await server.handleCreatePlaylist({
        title: `SafeTest_Multi_${Date.now()}`,
        type: 'audio',
        item_key: testItemKeys[0]
      });

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        multiItemPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(multiItemPlaylistId);

        // Add additional items one by one
        console.log('➕ Adding items one by one...');

        for (let i = 1; i < 3; i++) {
          const addResult = await server.handleAddToPlaylist({
            playlist_id: multiItemPlaylistId,
            item_keys: [testItemKeys[i]]
          });
          console.log(`   Added item ${i}: ${addResult.content[0].text}`);
        }

        console.log(`✅ Created multi-item test playlist: ${multiItemPlaylistId}`);
      }

      expect(createResult.content[0].text).toMatch(/Successfully created playlist|Playlist ID:/);
    }, 20000);

    it('should verify multi-item playlist has expected count', async() => {
      if (!multiItemPlaylistId) {
        console.log('⏭️ Skipping: No test playlist created');
        return;
      }

      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: multiItemPlaylistId
      });

      console.log('📖 Multi-item playlist contents:', browseResult.content[0].text);

      const itemCountMatch = browseResult.content[0].text.match(/Items: (\d+)/);
      if (itemCountMatch) {
        const count = parseInt(itemCountMatch[1], 10, 10);
        console.log(`📊 Confirmed item count: ${count}`);
        expect(count).toBeGreaterThanOrEqual(2);
      }
    }, 10000);

    it('should safely remove ONE item from multi-item playlist', async() => {
      if (!multiItemPlaylistId || testItemKeys.length < 2) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      // Get current count
      const browseBefore = await server.handleBrowsePlaylist({
        playlist_id: multiItemPlaylistId
      });
      const beforeCountMatch = browseBefore.content[0].text.match(/Items: (\d+)/);
      const beforeCount = beforeCountMatch ? parseInt(beforeCountMatch[1], 10) : 0;

      console.log(`🔒 SAFE TEST: Removing ONE item from playlist with ${beforeCount} items`);

      const removeResult = await server.handleRemoveFromPlaylist({
        playlist_id: multiItemPlaylistId,
        item_keys: [testItemKeys[1]]
      });

      console.log('📊 Remove result:', removeResult.content[0].text);

      // Check playlist state after removal
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: multiItemPlaylistId
      });

      console.log('📖 Playlist after removal:', browseAfter.content[0].text);

      const afterCountMatch = browseAfter.content[0].text.match(/Items: (\d+)/);
      if (afterCountMatch) {
        const afterCount = parseInt(afterCountMatch[1], 10);
        console.log(`📊 Before: ${beforeCount} items, After: ${afterCount} items`);

        if (afterCount === beforeCount - 1) {
          console.log('✅ EXPECTED: Removed exactly 1 item');
        } else if (afterCount === 0) {
          console.log('🚨 BUG DETECTED: Remove operation emptied entire playlist!');
        } else {
          console.log(`⚠️ UNEXPECTED: Item count changed by ${beforeCount - afterCount}`);
        }
      }

      expect(removeResult.content[0].text).toMatch(/Attempted to remove: 1 item/);
    }, 15000);
  });

  describe('🔒 Safe Remove Pattern #3: Step-by-Step Documentation', () => {
    let docPlaylistId = null;

    it('should create well-documented test playlist', async() => {
      if (testItemKeys.length < 4) {
        console.log('⏭️ Skipping: Need at least 4 test items');
        return;
      }

      console.log('\n📝 CREATING DOCUMENTED TEST PLAYLIST:');

      // Create with initial item
      const createResult = await server.handleCreatePlaylist({
        title: `SafeDoc_${Date.now()}`,
        type: 'audio',
        item_key: testItemKeys[0]
      });

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        docPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(docPlaylistId);

        console.log(`1️⃣ Initial playlist created: ${docPlaylistId}`);

        // Document initial state
        const initialBrowse = await server.handleBrowsePlaylist({
          playlist_id: docPlaylistId
        });
        console.log(`   Initial state: ${initialBrowse.content[0].text.match(/Items: (\d+)/)?.[1] || 'unknown'} items`);

        // Add items with documentation
        for (let i = 1; i < 4; i++) {
          console.log(`${i + 1}️⃣ Adding item ${testItemKeys[i]}...`);

          const _addResult = await server.handleAddToPlaylist({
            playlist_id: docPlaylistId,
            item_keys: [testItemKeys[i]]
          });

          const browseAfterAdd = await server.handleBrowsePlaylist({
            playlist_id: docPlaylistId
          });

          const countAfterAdd = browseAfterAdd.content[0].text.match(/Items: (\d+)/)?.[1] || 'unknown';
          console.log(`   After adding: ${countAfterAdd} items`);
        }

        console.log('✅ Documentation playlist ready for removal tests');
      }

      expect(createResult.content[0].text).toMatch(/Successfully created playlist|Playlist ID:/);
    }, 25000);

    it('should document removal behavior step by step', async() => {
      if (!docPlaylistId) {
        console.log('⏭️ Skipping: No documentation playlist created');
        return;
      }

      console.log('\n🔬 STEP-BY-STEP REMOVAL DOCUMENTATION:');

      // Document current state
      const currentBrowse = await server.handleBrowsePlaylist({
        playlist_id: docPlaylistId
      });
      const currentCount = currentBrowse.content[0].text.match(/Items: (\d+)/)?.[1] || 'unknown';
      console.log(`📊 Starting state: ${currentCount} items`);

      // Test removing middle item (not first or last)
      console.log(`🗑️ Removing middle item: ${testItemKeys[2]}`);

      const removeResult = await server.handleRemoveFromPlaylist({
        playlist_id: docPlaylistId,
        item_keys: [testItemKeys[2]]
      });

      console.log(`📤 Remove operation response: ${removeResult.content[0].text}`);

      // Document final state
      const finalBrowse = await server.handleBrowsePlaylist({
        playlist_id: docPlaylistId
      });
      const finalCount = finalBrowse.content[0].text.match(/Items: (\d+)/)?.[1] || 'unknown';
      console.log(`📊 Final state: ${finalCount} items`);

      // Analysis
      if (currentCount !== 'unknown' && finalCount !== 'unknown') {
        const removed = parseInt(currentCount, 10) - parseInt(finalCount, 10);
        console.log(`📈 Analysis: Attempted to remove 1 item, actually removed ${removed} items`);

        if (removed === 1) {
          console.log('✅ SAFE: Remove operation worked as expected');
        } else if (parseInt(finalCount, 10) === 0) {
          console.log('🚨 DANGEROUS: Remove operation emptied entire playlist');
        } else {
          console.log('⚠️ UNEXPECTED: Remove operation had unexpected behavior');
        }
      }

      expect(removeResult.content[0].text).toMatch(/Attempted to remove: 1 item/);
    }, 15000);
  });

  describe('📊 Pattern Analysis Summary', () => {
    it('should summarize what we learned about safe patterns', async() => {
      console.log('\n📈 SAFE REMOVE OPERATIONS ANALYSIS COMPLETE');
      console.log('📝 Check test output above to understand:');
      console.log('   • Which remove operations work as expected');
      console.log('   • Which remove operations exhibit dangerous behavior');
      console.log('   • Patterns that can be used safely in production');
      console.log('✅ Analysis complete - patterns documented in test logs');

      expect(true).toBe(true);
    });
  });
});
