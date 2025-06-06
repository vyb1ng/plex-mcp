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

### Option 1: Using npx (Recommended)

Add this configuration to your Claude Desktop settings:

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

### Option 2: Local development

For local development, add this configuration:

```json
{
  "mcpServers": {
    "plex": {
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