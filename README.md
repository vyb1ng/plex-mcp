# Plex MCP Server
[![smithery badge](https://smithery.ai/badge/@vyb1ng/plex-mcp)](https://smithery.ai/server/@vyb1ng/plex-mcp)

Search and manage your Plex media libraries with Claude. Actively developed by Claude and a nerdy human who mostly uses Plex for auditory delights and wanted to see how much could be accomplished without knowing much about what they're doing. Results may vary, but probably in a good way.

## Quick Start

### Install via Smithery (Recommended)
```bash
npx -y @smithery/cli install @vyb1ng/plex-mcp --client claude
```

### Manual Setup for Claude Desktop

Add to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "plex": {
      "command": "npx",
      "args": ["plex-mcp"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400"
      }
    }
  }
}
```

## Authentication

**Option 1: OAuth (Recommended)**
- Use the `authenticate_plex` tool to get a login URL
- Sign in through your browser

**Option 2: Static Token**
- Add `"PLEX_TOKEN": "your_token"` to the env section
- Get your token from [Plex Support](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)

**Note:** Replace `your-plex-server:32400` with your actual Plex server address and port.

## HTTP Debug Logging

For troubleshooting connection issues, you can enable comprehensive HTTP request/response logging:

```json
{
  "mcpServers": {
    "plex": {
      "command": "npx",
      "args": ["plex-mcp"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400",
        "MCP_HTTP_DEBUG": "true"
      }
    }
  }
}
```

When `MCP_HTTP_DEBUG=true`, the server will log:
- **Request Details**: Method, URL, headers, parameters, timing
- **Response Details**: Status codes, headers, response size, duration
- **Error Diagnostics**: Connection details, TLS/SSL certificate info, troubleshooting suggestions
- **Performance Metrics**: DNS lookup, TCP connection, TLS handshake timing
- **Security**: All sensitive headers (tokens, auth) are automatically redacted

All logs are structured JSON with correlation IDs for request/response tracking.

## What You Can Do

**Search & Browse**
- Search movies, TV shows, music, and other content
- Browse libraries and collections
- View recently added content and watch history

**Music Discovery**
- Natural language music discovery ("songs from the 90s", "rock bands I haven't heard")
- Smart recommendations based on listening patterns
- Intelligent randomization for variety and surprise
- Similar artist discovery and genre exploration

**Playlists**
- Create and manage playlists
- Add items to existing playlists
- Browse playlist contents

**Media Info**
- Get detailed media information (codecs, bitrates, file sizes)
- Check watch status and progress
- View library statistics and listening stats

**Resources (Data Access)**
- Access structured data via URI: `plex://libraries`, `plex://recent`, `plex://playlists`
- Library-specific data: `plex://library/{id}`, `plex://library/{id}/recent`
- Server statistics and connection status
- JSON-formatted data for analysis and automation

**Prompts (AI Assistance)**
- **playlist_description**: Generate creative playlist descriptions
- **content_recommendation**: Get personalized content recommendations
- **smart_playlist_rules**: Create smart playlist criteria and rules
- **media_analysis**: Analyze library content and patterns
- **server_troubleshooting**: Diagnose server connection issues

## Status

**✅ Working:** Search, browse, playlists, media info, library stats, watch history, collections, music discovery, resources, prompts

**❌ Disabled:** Smart playlists (filter logic broken)

**🚧 Planned:** Remote server browsing

## Development

Want to contribute? Point Claude at your local version:

```json
{
  "mcpServers": {
    "plex-dev": {
      "command": "node",
      "args": ["/path/to/plex-mcp/index.js"],
      "env": {
        "PLEX_URL": "http://your-plex-server:32400"
      }
    }
  }
}
```

It works for us. If it doesn't work for you, well we tried. Hit us up, we don't bite. Much.
