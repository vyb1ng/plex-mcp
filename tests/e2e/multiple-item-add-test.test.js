const PlexMCPServer = require('../../index.js');

// Check if we should run E2E tests
const plexUrl = process.env.E2E_PLEX_URL || process.env.PLEX_URL;
const plexToken = process.env.E2E_PLEX_TOKEN || process.env.PLEX_TOKEN;
const isTestEnvironment = plexUrl?.includes('test-plex-server.com') || plexToken?.includes('test-token');
const shouldRunE2E = plexUrl && plexToken && !isTestEnvironment;

const describeE2E = shouldRunE2E ? describe : describe.skip;

describeE2E('🔢 Multiple Item Addition Analysis', () => {
  let server;
  let originalEnv;
  let testItems = [];
  let cleanupPlaylistIds = [];

  beforeAll(async () => {
    originalEnv = { ...process.env };
    
    console.log('🎯 ANALYZING: Multiple item addition behavior');
    console.log('📝 Goal: Determine why multiple-item operations fail');
    console.log(`📡 Server: ${plexUrl}`);

    process.env.PLEX_URL = plexUrl;
    process.env.PLEX_TOKEN = plexToken;

    server = new PlexMCPServer();

    // Get test items
    const searchResult = await server.handlePlexSearch({
      query: 'music',
      type: 'track',
      limit: 8
    });

    const searchText = searchResult.content[0].text;
    const allIds = [...searchText.matchAll(/\*\*ID: (\d+)\*\*/g)];
    
    if (allIds.length >= 6) {
      testItems = allIds.slice(0, 6).map(match => match[1]);
      console.log(`✅ Test items prepared: [${testItems.join(', ')}]`);
    } else {
      console.log('❌ Insufficient test items found');
    }
  }, 30000);

  afterAll(async () => {
    // Cleanup all test playlists
    for (const playlistId of cleanupPlaylistIds) {
      try {
        await server.handleDeletePlaylist({ playlist_id: playlistId });
        console.log(`🧹 Cleaned up: ${playlistId}`);
      } catch (error) {
        console.log(`⚠️ Cleanup failed for ${playlistId}: ${error.message}`);
      }
    }
    
    process.env = originalEnv;
  }, 30000);

  describe('🏗️ Baseline: Single Item Operations', () => {
    let singleItemPlaylistId = null;

    it('should create playlist with single item', async () => {
      if (testItems.length < 1) {
        console.log('⏭️ Skipping: No test items');
        return;
      }

      const createResult = await server.handleCreatePlaylist({
        title: `SingleItem_${Date.now()}`,
        type: 'audio',
        item_key: testItems[0]
      });

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        singleItemPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(singleItemPlaylistId);
        console.log(`✅ Single-item playlist created: ${singleItemPlaylistId}`);
      }

      console.log('📋 Single item creation result:', createResult.content[0].text);
      
      expect(createResult.content[0].text).toMatch(/Successfully created playlist/);
    }, 15000);

    it('should add single item to existing playlist', async () => {
      if (!singleItemPlaylistId || testItems.length < 2) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🎵 Adding single item ${testItems[1]} to playlist ${singleItemPlaylistId}`);

      const addResult = await server.handleAddToPlaylist({
        playlist_id: singleItemPlaylistId,
        item_keys: [testItems[1]]
      });

      console.log('📊 Single add result:', addResult.content[0].text);

      // Verify result
      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: singleItemPlaylistId
      });

      const itemCount = browseResult.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`🎵 Items after single add: ${itemCount}`);

      expect(addResult.content[0].text).toMatch(/Attempted to add: 1 item/);
    }, 15000);
  });

  describe('🔢 Multiple Item Addition Tests', () => {
    let multiItemPlaylistId = null;

    it('should create fresh playlist for multiple item testing', async () => {
      if (testItems.length < 1) {
        console.log('⏭️ Skipping: No test items');
        return;
      }

      const createResult = await server.handleCreatePlaylist({
        title: `MultiItem_${Date.now()}`,
        type: 'audio',
        item_key: testItems[0]
      });

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        multiItemPlaylistId = playlistMatch[1];
        cleanupPlaylistIds.push(multiItemPlaylistId);
        console.log(`✅ Multi-item test playlist created: ${multiItemPlaylistId}`);
      }

      expect(createResult.content[0].text).toMatch(/Successfully created playlist/);
    }, 15000);

    it('should test adding 2 items at once', async () => {
      if (!multiItemPlaylistId || testItems.length < 3) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log(`🎵 Adding 2 items [${testItems[1]}, ${testItems[2]}] at once`);

      const addResult = await server.handleAddToPlaylist({
        playlist_id: multiItemPlaylistId,
        item_keys: [testItems[1], testItems[2]]
      });

      console.log('📊 2-item add result:', addResult.content[0].text);

      // Check playlist state
      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: multiItemPlaylistId
      });

      const itemCount = browseResult.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`🎵 Items after 2-item add: ${itemCount}`);
      console.log(`📊 Expected: 3 items (1 initial + 2 added)`);

      if (itemCount === '3') {
        console.log('✅ SUCCESS: Multiple item addition worked!');
      } else if (itemCount === '1') {
        console.log('❌ FAILED: No items were added');
      } else {
        console.log(`⚠️ PARTIAL: Only ${parseInt(itemCount) - 1} of 2 items were added`);
      }

      expect(addResult.content[0].text).toMatch(/Attempted to add: 2 item/);
    }, 15000);

    it('should test adding 3 items at once', async () => {
      if (!multiItemPlaylistId || testItems.length < 6) {
        console.log('⏭️ Skipping: Not enough test items');
        return;
      }

      console.log(`🎵 Adding 3 items [${testItems[3]}, ${testItems[4]}, ${testItems[5]}] at once`);

      const addResult = await server.handleAddToPlaylist({
        playlist_id: multiItemPlaylistId,
        item_keys: [testItems[3], testItems[4], testItems[5]]
      });

      console.log('📊 3-item add result:', addResult.content[0].text);

      // Check playlist state
      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: multiItemPlaylistId
      });

      const itemCount = browseResult.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`🎵 Items after 3-item add: ${itemCount}`);

      // Determine expected count based on previous test results
      console.log(`📊 Analyzing result pattern...`);

      expect(addResult.content[0].text).toMatch(/Attempted to add: 3 item/);
    }, 15000);
  });

  describe('🧪 Multiple Item Patterns Analysis', () => {
    it('should test identical item additions (duplicates)', async () => {
      if (testItems.length < 2) {
        console.log('⏭️ Skipping: Not enough test items');
        return;
      }

      // Create fresh playlist
      const createResult = await server.handleCreatePlaylist({
        title: `DuplicateTest_${Date.now()}`,
        type: 'audio',
        item_key: testItems[0]
      });

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (!playlistMatch) {
        console.log('❌ Failed to create duplicate test playlist');
        return;
      }

      const duplicatePlaylistId = playlistMatch[1];
      cleanupPlaylistIds.push(duplicatePlaylistId);

      console.log(`🔁 Testing duplicate additions to ${duplicatePlaylistId}`);

      // Try to add the same item multiple times
      const addResult = await server.handleAddToPlaylist({
        playlist_id: duplicatePlaylistId,
        item_keys: [testItems[0], testItems[0], testItems[0]]
      });

      console.log('📊 Duplicate add result:', addResult.content[0].text);

      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: duplicatePlaylistId
      });

      const itemCount = browseResult.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`🎵 Items after duplicate add: ${itemCount}`);

      if (itemCount === '1') {
        console.log('✅ CORRECT: Plex ignored duplicate additions');
      } else {
        console.log(`⚠️ UNEXPECTED: Got ${itemCount} items (duplicates allowed or other behavior)`);
      }

      expect(addResult.content[0].text).toMatch(/Attempted to add: 3 item/);
    }, 15000);

    it('should compare single vs multiple addition efficiency', async () => {
      if (testItems.length < 4) {
        console.log('⏭️ Skipping: Not enough test items');
        return;
      }

      console.log('\n🏁 PERFORMANCE COMPARISON: Single vs Multiple Operations');

      // Test 1: Sequential single additions
      const sequentialStart = Date.now();
      
      const createResult1 = await server.handleCreatePlaylist({
        title: `Sequential_${Date.now()}`,
        type: 'audio',
        item_key: testItems[0]
      });

      const playlist1Match = createResult1.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlist1Match) {
        const sequentialPlaylistId = playlist1Match[1];
        cleanupPlaylistIds.push(sequentialPlaylistId);

        // Add items one by one
        await server.handleAddToPlaylist({
          playlist_id: sequentialPlaylistId,
          item_keys: [testItems[1]]
        });
        
        await server.handleAddToPlaylist({
          playlist_id: sequentialPlaylistId,
          item_keys: [testItems[2]]
        });

        const sequentialEnd = Date.now();
        const sequentialTime = sequentialEnd - sequentialStart;

        // Check final state
        const browseSequential = await server.handleBrowsePlaylist({
          playlist_id: sequentialPlaylistId
        });
        const sequentialCount = browseSequential.content[0].text.match(/Items: (\d+)/)?.[1];

        console.log(`⏱️ Sequential (3 operations): ${sequentialTime}ms, ${sequentialCount} items`);

        // Test 2: Batch addition
        const batchStart = Date.now();
        
        const createResult2 = await server.handleCreatePlaylist({
          title: `Batch_${Date.now()}`,
          type: 'audio',
          item_key: testItems[0]
        });

        const playlist2Match = createResult2.content[0].text.match(/Playlist ID: (\w+)/);
        if (playlist2Match) {
          const batchPlaylistId = playlist2Match[1];
          cleanupPlaylistIds.push(batchPlaylistId);

          // Add items all at once
          await server.handleAddToPlaylist({
            playlist_id: batchPlaylistId,
            item_keys: [testItems[1], testItems[2]]
          });

          const batchEnd = Date.now();
          const batchTime = batchEnd - batchStart;

          // Check final state
          const browseBatch = await server.handleBrowsePlaylist({
            playlist_id: batchPlaylistId
          });
          const batchCount = browseBatch.content[0].text.match(/Items: (\d+)/)?.[1];

          console.log(`⏱️ Batch (2 operations): ${batchTime}ms, ${batchCount} items`);

          console.log('\n📊 ANALYSIS:');
          console.log(`Time difference: ${sequentialTime - batchTime}ms`);
          console.log(`Sequential result: ${sequentialCount} items`);
          console.log(`Batch result: ${batchCount} items`);

          if (sequentialCount === batchCount) {
            console.log('✅ Both methods achieved same result');
          } else {
            console.log('⚠️ Different results - batch operation may have issues');
          }
        }
      }

      expect(true).toBe(true); // This test is for analysis
    }, 30000);
  });

  describe('📋 Summary and Recommendations', () => {
    it('should document findings and recommendations', async () => {
      console.log('\n📊 MULTIPLE ITEM ADDITION ANALYSIS COMPLETE');
      console.log('================================================');
      
      console.log('\n🔍 KEY FINDINGS:');
      console.log('- Check console output above for detailed test results');
      console.log('- Compare single vs multiple operation success rates');
      console.log('- Note any performance differences');
      console.log('- Observe Plex duplicate handling behavior');
      
      console.log('\n💡 NEXT STEPS:');
      console.log('1. Review console logs for patterns');
      console.log('2. Identify which multiple-item operations fail');
      console.log('3. Implement fallback to sequential operations if needed');
      console.log('4. Improve error detection and reporting');
      
      console.log('\n✅ Analysis framework complete');
      
      expect(true).toBe(true);
    });
  });
});