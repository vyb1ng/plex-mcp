# Plex MCP Server
[![smithery badge](https://smithery.ai/badge/@vyb1ng/plex-mcp)](https://smithery.ai/server/@vyb1ng/plex-mcp)

A Model Context Protocol (MCP) server for searching Plex media libraries using Claude.

## Features

- Search movies, TV shows, episodes, music, and other content in your Plex libraries
- Filter by content type
- Configurable result limits
- Rich formatted results with metadata
- **Direct Plex authentication with OAuth flow**
- Support for both static tokens and interactive authentication

## Setup

### Installing via Smithery

To install plex-mcp for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@vyb1ng/plex-mcp):

```bash
npx -y @smithery/cli install @vyb1ng/plex-mcp --client claude
```

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your Plex connection (two options):

   **Option A: Interactive Authentication (Recommended)**
   - Set your Plex server URL:
     ```
     PLEX_URL=http://your-plex-server:32400
     ```
   - Use the `authenticate_plex` tool for OAuth login (see Authentication section below)

   **Option B: Static Token**
   - Set your Plex server URL and token:
     ```
     PLEX_URL=http://your-plex-server:32400
     PLEX_TOKEN=your_plex_token
     ```
   - Get your Plex token by visiting [Plex Token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)

## Claude Desktop Configuration

### Option 1: Production (Using npx - Recommended)

Add this configuration to your Claude Desktop settings for the stable published version:

```json
{
  "mcpServers": {
    "plex": {
      "command": "npx",
      "args": ["plex-mcp"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400",
        "PLEX_TOKEN": "your_plex_token"
      }
    }
  }
}
```

### Option 2: Development (Local)

For development with your local code changes, add this configuration:

```json
{
  "mcpServers": {
    "plex-dev": {
      "command": "node",
      "args": ["/path/to/your/plex-mcp/index.js"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400",
        "PLEX_TOKEN": "your_plex_token"
      }
    }
  }
}
```

Replace `/path/to/your/plex-mcp/` with the actual path to this project directory.

### Running Both Versions

You can configure both versions simultaneously by using different server names (`plex` and `plex-dev`):

```json
{
  "mcpServers": {
    "plex": {
      "command": "npx",
      "args": ["plex-mcp"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400",
        "PLEX_TOKEN": "your_plex_token"
      }
    },
    "plex-dev": {
      "command": "node",
      "args": ["/path/to/your/plex-mcp/index.js"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400",
        "PLEX_TOKEN": "your_plex_token"
      }
    }
  }
}
```

**Configuration Steps:**
1. Open Claude Desktop settings (Cmd/Ctrl + ,)
2. Navigate to the "MCP Servers" tab
3. Add the configuration above
4. Update `PLEX_URL` and `PLEX_TOKEN` with your Plex server details
5. Restart Claude Desktop

## Usage

Run the MCP server standalone:
```bash
node index.js
```

## Authentication

The Plex MCP server supports two authentication methods:

### 1. Interactive OAuth Authentication (Recommended)

Use the built-in OAuth flow for secure, interactive authentication:

1. **Start Authentication:**
   ```
   Use the authenticate_plex tool
   ```
   This will provide you with a Plex login URL and pin ID.

2. **Complete Login:**
   - Open the provided URL in your browser
   - Sign into your Plex account
   - Grant access to the MCP application

3. **Check Authentication Status:**
   ```
   Use the check_auth_status tool
   ```
   This confirms authentication completion and stores your token.

4. **Clear Authentication (Optional):**
   ```
   Use the clear_auth tool
   ```
   This removes stored credentials if needed.

### 2. Static Token Authentication

For automated setups or if you prefer manual token management:

1. Obtain your Plex token from [Plex Support](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
2. Set the `PLEX_TOKEN` environment variable
3. All tools will automatically use this token

**Note:** The OAuth method takes precedence - if both are available, static tokens are used as fallback.

## MCP Tools

### 🔴 Known Issues

**⚠️ Smart Playlist Creation (TEMPORARILY DISABLED)**
- The `create_smart_playlist` tool is currently disabled due to filter logic bugs
- Smart playlists were being created but with incorrect content and inflated metadata
- Use the regular `create_playlist` tool as an alternative
- Issue under investigation - will be re-enabled once fixed

### ✅ Working Tools

### Authentication Tools

#### authenticate_plex
Start the Plex OAuth authentication flow.

**Parameters:** None

**Returns:** Login URL and pin ID for browser authentication.

#### check_auth_status
Check if OAuth authentication is complete and retrieve the token.

**Parameters:**
- `pin_id` (string, optional): Specific pin ID to check

**Returns:** Authentication status and success confirmation.

#### clear_auth
Clear stored authentication credentials.

**Parameters:** None

**Returns:** Confirmation of credential removal.

### Content Tools

#### search_plex

Search for content in your Plex libraries.

**Parameters:**
- `query` (string, required): Search query
- `type` (string, optional): Content type ("movie", "show", "episode", "artist", "album", "track")
- `limit` (number, optional): Maximum results (default: 10)

**Example:**
```json
{
  "query": "Star Wars",
  "type": "movie",
  "limit": 5
}
```

#### browse_libraries
List all available Plex libraries (Movies, TV Shows, Music, etc.)

#### browse_library
Browse content within a specific library with filtering and sorting options

#### get_recently_added
Get recently added content from Plex libraries

#### get_watch_history
Get playback history for the Plex server

#### get_on_deck
Get 'On Deck' items (continue watching) for users

### Playlist Tools

#### list_playlists
List all playlists on the Plex server

#### browse_playlist
Browse and view the contents of a specific playlist

#### create_playlist ✅
Create a new regular playlist (requires an initial item)

#### ~~create_smart_playlist~~ ❌ **DISABLED**
~~Create smart playlists with filter criteria~~ - Currently disabled due to filter logic bugs

#### add_to_playlist
Add items to an existing playlist

#### delete_playlist
Delete an existing playlist

### Media Information Tools

#### get_watched_status
Check watch status and progress for specific content items

#### get_collections
List all collections available on the Plex server

#### browse_collection
Browse content within a specific collection

#### get_media_info
Get detailed technical information about media files (codecs, bitrates, file sizes, etc.)

#### get_library_stats
Get comprehensive statistics about Plex libraries (storage usage, file counts, content breakdown, etc.)

#### get_listening_stats
Get detailed listening statistics and music recommendations based on play history

## Tool Status Summary

### ✅ Fully Working
- All authentication tools (`authenticate_plex`, `check_auth_status`, `clear_auth`)
- All search and browse tools (`search_plex`, `browse_libraries`, `browse_library`)
- All activity tools (`get_recently_added`, `get_watch_history`, `get_on_deck`)  
- Regular playlist tools (`list_playlists`, `browse_playlist`, `create_playlist`, `add_to_playlist`, `delete_playlist`)
- All information tools (`get_watched_status`, `get_collections`, `browse_collection`, `get_media_info`, `get_library_stats`, `get_listening_stats`)

### ❌ Temporarily Disabled
- `create_smart_playlist` - Filter logic is broken, returns incorrect content with inflated metadata

### ⚠️ Known Limitations
- Smart playlist filtering system needs complete rework
- Some advanced filter combinations may not work as expected
- SSL certificate validation can be disabled with `PLEX_VERIFY_SSL=false` environment variable
