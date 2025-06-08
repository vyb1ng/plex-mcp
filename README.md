# Plex MCP Server

A Model Context Protocol (MCP) server for searching Plex media libraries using Claude.

## Features

- Search movies, TV shows, episodes, music, and other content in your Plex libraries
- Filter by content type
- Configurable result limits
- Rich formatted results with metadata

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your Plex connection:
   - Copy `.env.example` to `.env`
   - Set your Plex server URL and token:
     ```
     PLEX_URL=http://your-plex-server:32400
     PLEX_TOKEN=your_plex_token
     ```

3. Get your Plex token:
   - Log into your Plex account
   - Go to Settings > Account > Privacy
   - Click "Show" next to "Plex Pass Subscription"
   - Your token will be displayed

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

## MCP Tools

### search_plex

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

## Plex API Limitations and Workarounds

This server implements several workarounds for known Plex API limitations:

### ⚠️ Playlist Remove Operations (DISABLED)

**Issue:** The `remove_from_playlist` function is **disabled** due to destructive Plex API behavior.

**Problem:** When removing items from playlists, the Plex API removes **ALL instances** of matching items, not just one instance. This can accidentally delete entire playlists.

**Workaround:** Use the `copy_playlist` function with `exclude_item_keys` parameter to create a new playlist without unwanted items, then delete the original if needed.

```json
{
  "source_playlist_id": "12345",
  "new_title": "My Playlist (Cleaned)",
  "exclude_item_keys": ["67890", "11111"]
}
```

### 🔄 Batch Item Operations

**Issue:** Adding multiple items to playlists in a single batch operation can be unreliable.

**Solution:** The `add_to_playlist` function now uses **sequential single-item operations** instead of batch operations for better reliability.

**Benefits:**
- Higher success rate for multiple item additions
- Individual error tracking per item
- Graceful handling of partial failures

### 📊 Response Verification

**Enhancement:** All playlist operations now verify their results by checking the actual playlist state after API calls.

**Features:**
- Before/after item counts for additions
- Deletion verification by attempting to access deleted playlists
- Clear success/failure reporting with detailed feedback

### 🏷️ Playlist Creation Requirements

**Limitation:** Non-smart playlists require an initial item to be created successfully.

**Workaround:** Always provide an `item_key` parameter when creating regular playlists. Smart playlists don't have this requirement.

**Example:**
```json
{
  "title": "My New Playlist",
  "type": "audio",
  "smart": false,
  "item_key": "12345"
}
```

### 🔧 Error Handling

The server implements standardized error responses categorizing common issues:

- **Authentication errors**: Check Plex token and permissions
- **Connection errors**: Verify PLEX_URL configuration  
- **Not found errors**: Invalid playlist/item IDs
- **Server errors**: Plex server-side issues
- **Configuration errors**: Missing environment variables

### 💡 Best Practices

1. **Use sequential operations** for reliability over speed
2. **Copy playlists instead of removing items** to avoid data loss
3. **Always verify results** by checking playlist state after operations
4. **Handle partial failures gracefully** when working with multiple items
5. **Use item keys from search results** for playlist operations