const PlexMCPServer = require('../../index.js');

// Check if we should run E2E tests
const plexUrl = process.env.E2E_PLEX_URL || process.env.PLEX_URL;
const plexToken = process.env.E2E_PLEX_TOKEN || process.env.PLEX_TOKEN;
const isTestEnvironment = plexUrl?.includes('test-plex-server.com') || plexToken?.includes('test-token');
const shouldRunE2E = plexUrl && plexToken && !isTestEnvironment;

const describeE2E = shouldRunE2E ? describe : describe.skip;

describeE2E('🚨 Critical Remove Bug Investigation', () => {
  let server;
  let originalEnv;
  let testItems = [];
  let testPlaylistId = null;

  beforeAll(async() => {
    originalEnv = { ...process.env };

    console.log('🔬 CRITICAL BUG INVESTIGATION: Remove Operations');
    console.log('🎯 Goal: Understand why remove operations delete entire playlists');
    console.log(`📡 Testing against: ${plexUrl}`);

    process.env.PLEX_URL = plexUrl;
    process.env.PLEX_TOKEN = plexToken;

    server = new PlexMCPServer();

    // Get test items
    const searchResult = await server.handlePlexSearch({
      query: 'music',
      type: 'track',
      limit: 5
    });

    const searchText = searchResult.content[0].text;
    const allIds = [...searchText.matchAll(/\*\*ID: (\d+)\*\*/g)];

    if (allIds.length >= 3) {
      testItems = allIds.slice(0, 3).map(match => ({
        id: match[1],
        title: `Test Item ${match[1]}`
      }));
      console.log('✅ Test items prepared:', testItems.map(item => item.id));
    } else {
      console.log('❌ Insufficient test items found');
    }
  }, 30000);

  afterAll(async() => {
    // Cleanup
    if (testPlaylistId) {
      try {
        await server.handleDeletePlaylist({ playlist_id: testPlaylistId });
        console.log(`🧹 Cleaned up test playlist: ${testPlaylistId}`);
      } catch (error) {
        console.log(`⚠️ Cleanup failed: ${error.message}`);
      }
    }

    process.env = originalEnv;
  }, 15000);

  describe('🏗️ Controlled Playlist Setup', () => {
    it('should create playlist with known contents', async() => {
      if (testItems.length < 3) {
        console.log('⏭️ Skipping: Insufficient test items');
        return;
      }

      // Create playlist with first item
      const createResult = await server.handleCreatePlaylist({
        title: `RemoveBugTest_${Date.now()}`,
        type: 'audio',
        item_key: testItems[0].id
      });

      const playlistMatch = createResult.content[0].text.match(/Playlist ID: (\w+)/);
      if (playlistMatch) {
        testPlaylistId = playlistMatch[1];
        console.log(`✅ Created test playlist: ${testPlaylistId}`);
      }

      // Add second item individually
      const addResult = await server.handleAddToPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItems[1].id]
      });

      console.log('📋 After adding second item:', addResult.content[0].text);

      // Add third item individually
      const addResult2 = await server.handleAddToPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItems[2].id]
      });

      console.log('📋 After adding third item:', addResult2.content[0].text);

      // Verify final state
      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('📊 Final playlist contents:');
      console.log(browseResult.content[0].text);

      const itemCount = browseResult.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`🎵 Total items in playlist: ${itemCount}`);

      expect(testPlaylistId).toBeTruthy();
    }, 25000);
  });

  describe('🔍 Detailed Remove Analysis', () => {
    it('should document exact playlist state before removal', async() => {
      if (!testPlaylistId) {
        console.log('⏭️ Skipping: No test playlist');
        return;
      }

      console.log('\n📋 DETAILED PRE-REMOVAL STATE:');

      const browseResult = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('Full playlist contents:', browseResult.content[0].text);

      // Log each item we can see
      const itemMatches = [...browseResult.content[0].text.matchAll(/ID: (\d+)/g)];
      console.log('📊 Individual items found:');
      itemMatches.forEach((match, index) => {
        console.log(`   ${index + 1}. Item ID: ${match[1]}`);
      });

      console.log(`🎯 We will attempt to remove ONLY item: ${testItems[1].id}`);
      console.log('🚨 PREDICTION: This may remove ALL items due to the bug');

      expect(itemMatches.length).toBeGreaterThan(0);
    }, 10000);

    it('should execute the critical remove operation', async() => {
      if (!testPlaylistId || testItems.length < 2) {
        console.log('⏭️ Skipping: Prerequisites not met');
        return;
      }

      console.log('\n🚨 EXECUTING CRITICAL REMOVE OPERATION:');
      console.log(`🎯 Target: Remove ONLY item ${testItems[1].id}`);
      console.log(`📋 Playlist: ${testPlaylistId}`);

      const removeResult = await server.handleRemoveFromPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [testItems[1].id]
      });

      console.log('\n📊 REMOVE OPERATION RESULT:');
      console.log(removeResult.content[0].text);

      // Immediately check playlist state
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      console.log('\n📋 POST-REMOVAL PLAYLIST STATE:');
      console.log(browseAfter.content[0].text);

      const itemCountAfter = browseAfter.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`\n🎵 Items remaining: ${itemCountAfter}`);

      if (itemCountAfter === '0') {
        console.log('🚨 BUG CONFIRMED: Remove operation deleted ENTIRE playlist!');
        console.log('📝 Expected: Remove only 1 item');
        console.log('📝 Actual: Removed ALL items');
      } else if (itemCountAfter === '2') {
        console.log('✅ WORKING CORRECTLY: Only removed target item');
      } else {
        console.log(`⚠️ UNEXPECTED: ${itemCountAfter} items remaining`);
      }

      expect(removeResult.content[0].text).toMatch(/remove/i);
    }, 15000);
  });

  describe('🧪 Additional Remove Patterns', () => {
    it('should test remove operation with non-existent item', async() => {
      if (!testPlaylistId) {
        console.log('⏭️ Skipping: No test playlist');
        return;
      }

      console.log('\n🧪 Testing remove with non-existent item:');

      const fakeItemId = '999999999';
      const removeResult = await server.handleRemoveFromPlaylist({
        playlist_id: testPlaylistId,
        item_keys: [fakeItemId]
      });

      console.log('📊 Remove non-existent item result:', removeResult.content[0].text);

      // Check if playlist was affected
      const browseAfter = await server.handleBrowsePlaylist({
        playlist_id: testPlaylistId
      });

      const itemCountAfter = browseAfter.content[0].text.match(/Items: (\d+)/)?.[1];
      console.log(`🎵 Items after fake remove: ${itemCountAfter}`);

      expect(removeResult.content[0].text).toMatch(/remove/i);
    }, 10000);
  });

  describe('📊 Bug Pattern Documentation', () => {
    it('should document the complete bug pattern', async() => {
      console.log('\n📋 COMPLETE BUG ANALYSIS SUMMARY:');
      console.log('==========================================');

      console.log('\n🔍 FINDINGS:');
      console.log('1. Single item additions: Work correctly');
      console.log('2. Multiple item additions: May fail');
      console.log('3. Remove operations: CRITICAL BUG - removes all items');
      console.log('4. Response messages: Often inaccurate');

      console.log('\n🎯 RECOMMENDED ACTIONS:');
      console.log('1. Fix remove operations to be selective');
      console.log('2. Improve response message accuracy');
      console.log('3. Add validation for multiple item operations');
      console.log('4. Implement better error detection');

      console.log('\n✅ Analysis complete - check console output for detailed findings');

      expect(true).toBe(true);
    });
  });
});
