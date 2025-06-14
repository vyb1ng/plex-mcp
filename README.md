# Plex MCP Server

A Model Context Protocol (MCP) server for searching Plex media libraries using Claude.

## Features

- Search movies, TV shows, episodes, music, and other content in your Plex libraries
- Filter by content type
- Configurable result limits
- Rich formatted results with metadata
- **Direct Plex authentication with OAuth flow**
- Support for both static tokens and interactive authentication

## Setup

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