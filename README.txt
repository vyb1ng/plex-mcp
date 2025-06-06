================================================================================
                             PLEX MCP SERVER
                    Model Context Protocol Server for Plex
================================================================================

DESCRIPTION
-----------
A comprehensive MCP (Model Context Protocol) server that provides AI assistants 
with full access to your Plex Media Server. Search, browse, manage playlists, 
analyze listening habits, and get detailed media information through a rich set 
of tools.

FEATURES
--------
• Search across all Plex libraries with advanced filtering
• Browse libraries, collections, and recently added content
• Comprehensive playlist management (create, modify, delete)
• Watch history and continue watching (On Deck) access
• Music listening statistics and recommendations
• Advanced content filtering (genre, year, rating, resolution, audio format)
• Media file analysis and codec information
• Library storage and usage analytics
• Activity-based filtering (play counts, last played dates)

REQUIREMENTS
------------
• Node.js 14+ 
• Plex Media Server with API access
• Valid Plex authentication token

INSTALLATION
------------
1. Clone this repository
2. Install dependencies:
   npm install

3. Set environment variables:
   export PLEX_URL="http://your-plex-server:32400"
   export PLEX_TOKEN="your-plex-token"

4. Run the server:
   node index.js

GETTING YOUR PLEX TOKEN
-----------------------
1. Sign in to Plex Web App
2. Open browser developer tools (F12)
3. Go to Network tab
4. Refresh the page
5. Look for requests to plex.tv with X-Plex-Token header
6. Copy the token value

AVAILABLE TOOLS
---------------

SEARCH & BROWSE:
• search_plex         - Search across all libraries with filters
• browse_libraries    - List all available Plex libraries  
• browse_library      - Browse content within a specific library
• browse_collections  - List all Plex collections
• browse_collection   - View contents of a specific collection
• get_recently_added  - Show recently added content

ACTIVITY & HISTORY:
• get_watch_history   - View playback history with filtering
• get_on_deck         - Show continue watching items
• get_watched_status  - Check watched status of content
• get_listening_stats - Music analytics and recommendations

PLAYLIST MANAGEMENT:
• list_playlists      - Show all playlists with filtering
• create_playlist     - Create new playlists (regular or smart)
• add_to_playlist     - Add items to existing playlists
• remove_from_playlist- Remove items from playlists
• delete_playlist     - Delete playlists

MEDIA INFO & STATS:
• get_media_info      - Detailed file and codec information
• get_library_stats   - Storage and usage analytics

FILTERING OPTIONS
-----------------

BASIC FILTERS (search_plex, browse_library):
• genre              - Filter by genre (Action, Comedy, Rock, etc.)
• year               - Specific release year
• year_min/year_max  - Year range filtering
• studio             - Studio or record label
• director/writer/actor - Cast and crew filtering
• rating_min/rating_max - Rating range (0-10 scale)
• duration_min/duration_max - Duration in minutes
• added_after/added_before - Date-based filtering

ACTIVITY FILTERS:
• play_count_min/max - Filter by play count range
• never_played       - Show only unplayed content
• last_played_after/before - Filter by last played date
• played_in_last_days - Recently played content

ADVANCED FILTERS:
• content_rating     - Content rating (G, PG, PG-13, R, etc.)
• resolution         - Video resolution (4k, 1080, 720, sd)
• audio_format       - Audio codec or quality (lossless, lossy, flac, etc.)
• file_size_min/max  - File size filtering in MB

USAGE EXAMPLES
--------------

Search for action movies from 2020-2023:
{
  "tool": "search_plex",
  "arguments": {
    "query": "action",
    "type": "movie", 
    "genre": "Action",
    "year_min": 2020,
    "year_max": 2023
  }
}

Browse music library for highly-rated albums never played:
{
  "tool": "browse_library",
  "arguments": {
    "library_id": "3",
    "type": "album",
    "rating_min": 8,
    "never_played": true,
    "sort": "rating"
  }
}

Get listening stats for the past month:
{
  "tool": "get_listening_stats", 
  "arguments": {
    "period": "month",
    "include_recommendations": true
  }
}

TESTING
-------
Run the test suite:
npm test

Run specific test suites:
npm test -- --testPathPattern=parsers.test.js
npm test -- --testPathPattern=handlers.test.js

DEVELOPMENT
-----------
The server is built using:
• Node.js with axios for HTTP requests
• Jest for testing with comprehensive unit and integration tests
• MCP (Model Context Protocol) for AI assistant integration

Project structure:
index.js                 - Main server implementation
tests/
  unit/                  - Unit tests for parsers, formatters, filters
  integration/           - Integration tests for handlers
  fixtures/              - Test data and mocks

ENVIRONMENT VARIABLES
---------------------
Required:
• PLEX_URL     - Your Plex server URL (e.g., http://localhost:32400)
• PLEX_TOKEN   - Your Plex authentication token

Optional:
• NODE_ENV     - Set to 'development' for debug logging

TROUBLESHOOTING
---------------
• Ensure Plex server is running and accessible
• Verify PLEX_TOKEN is valid and has proper permissions
• Check network connectivity between server and Plex
• Enable debug logging with NODE_ENV=development

For 401 Unauthorized errors, regenerate your Plex token.
For connection errors, verify PLEX_URL and network settings.

LICENSE
-------
This project is open source. See LICENSE file for details.

CONTRIBUTING
------------
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

================================================================================
For support and updates, visit: https://github.com/vyb1ng/plex-mcp
================================================================================