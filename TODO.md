# Plex MCP Server - TODO List

## Recent Completions

### ✅ Completed Items
- **Plex Item ID Investigation** - Identified correct field usage for playlist operations
  - Confirmed `ratingKey` is the primary identifier for all playlist operations
  - Documented ID field relationships (`ratingKey`, `key`, `machineIdentifier`)
  - Found URI format conversion pattern for server operations
- **Playlist Operation Parameter Analysis** - Verified correct API parameter formats
  - Confirmed `item_keys` array expects `ratingKey` values from search results
  - Documented URI conversion: `ratingKey` → `server://localhost/com.plexapp.plugins.library/library/metadata/{key}`
- **Live Playlist Test Implementation** - Created comprehensive E2E test sequence
  - Added playlist creation test with dynamic item search
  - Added playlist item addition test with multiple items
  - Added playlist browsing verification test
  - Tests extract `ratingKey` from search results using `**ID: (\d+)**` pattern
- **Browse Playlist Bug Fix** - Fixed empty results issue in `handleBrowsePlaylist`
  - Added missing pagination parameters (`X-Plex-Container-Start`, `X-Plex-Container-Size`)
  - Added fallback to `/playlists/{id}/items` endpoint when main endpoint returns empty
  - Added `leafCount` check to detect playlists that should have items

## Unimplemented Plex API Features

# Random human shit

SMithery integration shows tools but no "provided resources" or "provided prompts" - we should identify what these mean and whether they are useful in the context of the Plex MCP.

### Critical Missing APIs (High Priority)

#### Session Management
- [ ] **get_active_sessions** - List current "Now Playing" sessions
  - Endpoint: `/status/sessions`
  - Returns: Active playback sessions with user, client, media info
- [ ] **get_transcode_sessions** - List active transcoding operations
  - Endpoint: `/transcode/sessions`
  - Returns: Transcoding progress, quality settings, resource usage
- [ ] **terminate_session** - Stop/kill active playback sessions
  - Endpoint: `/status/sessions/terminate`
  - Action: Force stop sessions by session ID

#### Playback Control
- [ ] **control_playback** - Control playback (play/pause/stop/seek)
  - Endpoint: `/player/playback/{command}`
  - Commands: play, pause, stop, stepForward, stepBack, seekTo
- [ ] **start_playback** - Initiate playback on specific clients
  - Endpoint: `/player/playback/playMedia`
  - Parameters: media key, client ID, resume offset
- [ ] **remote_control** - Advanced remote control operations
  - Endpoint: `/player/navigation/{command}`
  - Commands: moveUp, moveDown, select, back, home

#### Client & Device Management
- [ ] **get_clients** - List available Plex clients/players
  - Endpoint: `/clients`
  - Returns: Client names, IDs, capabilities, online status
- [ ] **get_devices** - List all registered devices
  - Endpoint: `/devices`
  - Returns: Device info, last seen, platform details
- [ ] **get_servers** - List available Plex servers
  - Endpoint: `/servers`
  - Returns: Server list for multi-server setups

### Server Administration (Medium Priority)

#### Server Info & Management
- [ ] **get_server_info** - Server capabilities and status
  - Endpoint: `/`
  - Returns: Version, capabilities, transcoder info, platform
- [ ] **get_server_preferences** - Server configuration settings
  - Endpoint: `/:/prefs`
  - Returns: All server preferences and settings
- [ ] **scan_library** - Trigger library content scan
  - Endpoint: `/library/sections/{id}/refresh`
  - Action: Force library scan for new content
- [ ] **refresh_metadata** - Force metadata refresh for items
  - Endpoint: `/library/metadata/{id}/refresh`
  - Action: Re-download metadata, artwork, etc.

#### User Management
- [ ] **get_users** - List server users and accounts
  - Endpoint: `/accounts`
  - Returns: User list, permissions, sharing status
- [ ] **get_user_activity** - User-specific activity logs
  - Endpoint: `/status/sessions/history/all?accountID={id}`
  - Returns: Per-user watch history and statistics

### Content Discovery & Recommendations (Medium Priority)

#### Advanced Discovery
- [ ] **get_content_hubs** - Plex's recommendation engine
  - Endpoint: `/hubs`
  - Returns: Curated content recommendations, trending
- [ ] **get_discover_content** - Discover new content across libraries
  - Endpoint: `/library/sections/all?discover=1`
  - Returns: Cross-library content discovery
- [ ] **get_trending** - Trending content on Plex platform
  - Endpoint: `/hubs/trending`
  - Returns: Popular content across Plex network

#### Metadata Enhancement
- [ ] **get_genres** - Available genres across libraries
  - Endpoint: `/library/sections/{id}/genre`
  - Returns: Genre list with item counts
- [ ] **get_years** - Available years across libraries
  - Endpoint: `/library/sections/{id}/year`
  - Returns: Year list with item counts
- [ ] **get_studios** - Available studios/networks
  - Endpoint: `/library/sections/{id}/studio`
  - Returns: Studio/network list with item counts
- [ ] **get_directors** - Available directors/actors
  - Endpoint: `/library/sections/{id}/director`
  - Returns: People list with filmography counts

### Media Management (Medium Priority)

#### Watch Status Management
- [ ] **mark_watched** - Mark items as watched
  - Endpoint: `/:/scrobble?key={id}&identifier=com.plexapp.plugins.library`
  - Action: Set watch status, update play count
- [ ] **mark_unwatched** - Mark items as unwatched
  - Endpoint: `/:/unscrobble?key={id}&identifier=com.plexapp.plugins.library`
  - Action: Remove watch status, reset play count
- [ ] **set_rating** - Rate content (stars/thumbs)
  - Endpoint: `/:/rate?key={id}&rating={rating}&identifier=com.plexapp.plugins.library`
  - Action: Set user rating for content

#### Library Maintenance
- [ ] **optimize_library** - Database optimization operations
  - Endpoint: `/library/optimize`
  - Action: Clean up database, optimize indexes
- [ ] **empty_trash** - Empty library trash/deleted items
  - Endpoint: `/library/sections/{id}/emptyTrash`
  - Action: Permanently delete trashed items
- [ ] **update_library** - Update library metadata
  - Endpoint: `/library/sections/{id}/update`
  - Action: Update library without full scan

### Advanced Features (Low Priority)

#### Transcoding Management
- [ ] **get_transcoding_settings** - Transcoding preferences
  - Endpoint: `/:/prefs?group=transcoder`
  - Returns: Quality settings, codec preferences
- [ ] **optimize_content** - Content optimization for devices
  - Endpoint: `/library/metadata/{id}/optimize`
  - Action: Pre-transcode content for specific devices

#### Sync & Download
- [ ] **get_sync_items** - Sync queue and downloaded items
  - Endpoint: `/sync/items`
  - Returns: Sync status, download queue
- [ ] **download_media** - Download content for offline viewing
  - Endpoint: `/sync/items`
  - Action: Queue content for download/sync

#### Webhooks & Events
- [ ] **get_webhooks** - List configured webhooks
  - Endpoint: `/:/webhooks`
  - Returns: Webhook URLs and trigger events
- [ ] **listen_events** - Real-time event streaming
  - Endpoint: `/:/events` (WebSocket/SSE)
  - Returns: Live server events, playback updates

## Missing Test Coverage

### Unit Tests
- [ ] **Session management handlers** - Tests for new session control APIs
- [ ] **Playback control handlers** - Tests for media control functionality
- [ ] **Client management handlers** - Tests for device/client discovery
- [ ] **Server admin handlers** - Tests for administrative functions
- [ ] **User management handlers** - Tests for multi-user functionality
- [ ] **Content discovery handlers** - Tests for recommendation features
- [ ] **Watch status handlers** - Tests for marking watched/unwatched
- [ ] **Library management handlers** - Tests for scan/refresh operations

### Integration Tests
- [ ] **Multi-library operations** - Cross-library search and discovery
- [ ] **Playlist management with new content** - Advanced playlist operations
- [ ] **User permission scenarios** - Multi-user access control
- [ ] **Server configuration changes** - Settings modification testing
- [ ] **Transcoding workflow** - End-to-end transcoding scenarios
- [ ] **Sync/download workflows** - Offline content management

### Mock Data Enhancement
- [ ] **Session data mocks** - Active session responses
- [ ] **Client data mocks** - Available client/device responses
- [ ] **Server info mocks** - Server capabilities and status
- [ ] **User data mocks** - Multi-user account responses
- [ ] **Transcoding mocks** - Transcoding session responses
- [ ] **Webhook mocks** - Event and webhook responses

## E2E Tests to Add

### Real Server Integration
- [ ] **Live session monitoring** - Connect to real server, monitor active sessions
  - Test with actual playback sessions
  - Verify session data accuracy
  - Test session termination
- [ ] **Live playback control** - Control actual Plex clients
  - Test play/pause/stop commands
  - Test seek functionality
  - Test client discovery and selection
- [ ] **Live library management** - Real library operations
  - Test library scanning
  - Test metadata refresh
  - Test library optimization
- [ ] **Live user scenarios** - Multi-user testing
  - Test shared library access
  - Test user-specific history
  - Test permission boundaries

### Cross-Platform Testing
- [ ] **Multiple client types** - Test with various Plex clients
  - Desktop app, mobile app, web player
  - Smart TV apps, streaming devices
  - Verify control compatibility
- [ ] **Multiple server versions** - Test against different Plex server versions
  - Latest stable, previous versions
  - PlexPass vs free features
  - API compatibility testing

### Network Scenarios
- [ ] **SSL/TLS configurations** - Various security setups
  - Self-signed certificates
  - Valid SSL certificates
  - Mixed HTTP/HTTPS environments
- [ ] **Remote access testing** - Plex relay and direct connections
  - Remote server access via Plex.tv
  - Direct IP connections
  - VPN/tunnel scenarios
- [ ] **Performance testing** - Large library scenarios
  - Libraries with 10k+ items
  - Multiple concurrent operations
  - Memory and CPU usage monitoring

## Code Quality & Architecture

### Error Handling Improvements
- [ ] **Granular error types** - Specific error classes for different failure modes
- [ ] **Retry mechanisms** - Automatic retry for transient failures
- [ ] **Circuit breaker pattern** - Fail-fast for consistently failing operations
- [ ] **Rate limiting** - Respect Plex server rate limits

### Performance Optimizations
- [ ] **Response caching** - Cache frequently accessed data
- [ ] **Batch operations** - Combine multiple API calls when possible
- [ ] **Streaming responses** - Handle large datasets efficiently
- [ ] **Connection pooling** - Reuse HTTP connections

### Documentation
- [ ] **API reference docs** - Complete documentation for all tools
- [ ] **Usage examples** - Real-world scenarios and code examples
- [ ] **Troubleshooting guide** - Common issues and solutions
- [ ] **Performance tuning** - Optimization recommendations

### Security Enhancements
- [ ] **Token validation** - Verify Plex token format and permissions
- [ ] **SSL certificate validation** - Proper certificate handling
- [ ] **Input sanitization** - Validate all user inputs
- [ ] **Audit logging** - Log all administrative operations

## Development Infrastructure

### CI/CD Improvements
- [ ] **Automated testing** - Run full test suite on every commit
- [ ] **Code coverage tracking** - Monitor and improve test coverage
- [ ] **Performance benchmarks** - Track performance regressions
- [ ] **Security scanning** - Automated vulnerability detection

### Development Tools
- [ ] **Mock Plex server** - Local development server for testing
- [ ] **Test data generator** - Generate realistic test datasets
- [ ] **Performance profiler** - Identify bottlenecks and optimize
- [ ] **Documentation generator** - Auto-generate API docs from code

