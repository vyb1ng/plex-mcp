#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const _axios = require('axios');
const { PlexOauth } = require('plex-oauth');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { HttpLogger } = require('./http-logger');

// Initialize HTTP logger with Plex MCP specific configuration
const httpLogger = new HttpLogger({
  serviceName: 'plex-mcp',
  debug: process.env.MCP_HTTP_DEBUG === 'true'
});

// Create axios instance with logging
const _axiosWithLogging = httpLogger.createAxiosInstance();

class PlexAuthManager {
  constructor() {
    this.authToken = null;
    this.plexOauth = null;
    this.currentPinId = null;
    this.tokenFilePath = path.join(os.homedir(), '.plex-mcp-token');
  }

  async loadPersistedToken() {
    try {
      if (fs.existsSync(this.tokenFilePath)) {
        const tokenData = fs.readFileSync(this.tokenFilePath, 'utf8');
        const parsed = JSON.parse(tokenData);
        if (parsed.token && parsed.timestamp) {
          // Check if token is less than 1 year old
          const tokenAge = Date.now() - parsed.timestamp;
          const oneYear = 365 * 24 * 60 * 60 * 1000;
          if (tokenAge < oneYear) {
            this.authToken = parsed.token;
            return parsed.token;
          }
        }
      }
    } catch (_error) {
      // If there's any error reading the token, just continue without it
      console.error('Error loading persisted token:', _error.message);
    }
    return null;
  }

  async saveToken(token) {
    try {
      const tokenData = {
        token: token,
        timestamp: Date.now()
      };
      fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokenData, null, 2), 'utf8');
    } catch (_error) {
      console.error('Error saving token:', _error.message);
    }
  }

  async clearPersistedToken() {
    try {
      if (fs.existsSync(this.tokenFilePath)) {
        fs.unlinkSync(this.tokenFilePath);
      }
    } catch (_error) {
      console.error('Error clearing persisted token:', _error.message);
    }
  }

  async getAuthToken() {
    // Try static token first
    const staticToken = process.env.PLEX_TOKEN;
    if (staticToken) {
      return staticToken;
    }

    // Return stored OAuth token if available
    if (this.authToken) {
      return this.authToken;
    }

    // Try to load persisted token
    const persistedToken = await this.loadPersistedToken();
    if (persistedToken) {
      return persistedToken;
    }

    throw new Error('No authentication token available. Please authenticate first using the authenticate_plex tool or set PLEX_TOKEN environment variable.');
  }

  initializeOAuth() {
    if (this.plexOauth) {
      return this.plexOauth;
    }

    const clientInfo = {
      clientIdentifier: process.env.PLEX_CLIENT_ID || 'plex-mcp-client',
      product: process.env.PLEX_PRODUCT || 'PlexMCP',
      device: process.env.PLEX_DEVICE || 'PlexMCP',
      version: process.env.PLEX_VERSION || '1.0.0',
      forwardUrl: process.env.PLEX_REDIRECT_URL || 'https://app.plex.tv/auth#!',
      platform: process.env.PLEX_PLATFORM || 'Web'
    };

    this.plexOauth = new PlexOauth(clientInfo);
    return this.plexOauth;
  }

  async requestAuthUrl() {
    const oauth = this.initializeOAuth();
    try {
      const [hostedUILink, pinId] = await oauth.requestHostedLoginURL();
      this.currentPinId = pinId;
      return { loginUrl: hostedUILink, pinId };
    } catch (_error) {
      throw new Error(`Failed to request authentication URL: ${_error.message}`);
    }
  }

  async checkAuthToken(pinId = null) {
    const oauth = this.initializeOAuth();
    const pin = pinId || this.currentPinId;

    if (!pin) {
      throw new Error('No pin ID available. Please request authentication first.');
    }

    try {
      const authToken = await oauth.checkForAuthToken(pin);
      if (authToken) {
        this.authToken = authToken;
        await this.saveToken(authToken);
        return authToken;
      }
      return null;
    } catch (_error) {
      throw new Error(`Failed to check authentication token: ${_error.message}`);
    }
  }

  async clearAuth() {
    this.authToken = null;
    this.currentPinId = null;
    await this.clearPersistedToken();
  }
}

class PlexMCPServer {
  constructor(options = {}) {
    this.server = new Server(
      {
        name: 'plex-search-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );

    this.authManager = new PlexAuthManager();
    this.connectionVerified = false;
    // Allow dependency injection for testing
    this.axios = options.axios || _axiosWithLogging;
    this.setupToolHandlers();
    this.setupResourceHandlers();
    this.setupPromptHandlers();
  }

  async verifyConnection() {
    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      if (!plexToken) {
        return {
          verified: false,
          error: 'No authentication token available. Please authenticate first.',
          needsAuth: true
        };
      }

      // Test basic connectivity with identity endpoint
      const identityUrl = `${plexUrl}/identity`;
      const response = await this.axios.get(identityUrl, {
        params: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent(),
        timeout: 10000
      });

      if (response.status === 200) {
        this.connectionVerified = true;
        return {
          verified: true,
          server: response.data?.MediaContainer?.machineIdentifier || 'Unknown',
          url: plexUrl
        };
      }

      return {
        verified: false,
        error: `Server responded with status ${response.status}`,
        needsAuth: false
      };
    } catch (_error) {
      let errorMessage = _error.message;
      let needsAuth = false;

      if (_error.response?.status === 401) {
        errorMessage = 'Authentication failed. Token may be expired.';
        needsAuth = true;
      } else if (_error.code === 'ECONNREFUSED' || _error.code === 'ENOTFOUND' || _error.code === 'ETIMEDOUT') {
        errorMessage = `Cannot connect to Plex server at ${process.env.PLEX_URL || 'https://app.plex.tv'}. Check network connectivity and server URL.`;
      }

      return {
        verified: false,
        error: errorMessage,
        needsAuth: needsAuth
      };
    }
  }

  async ensureConnection() {
    if (this.connectionVerified) {
      return { success: true };
    }

    const verification = await this.verifyConnection();

    if (!verification.verified) {
      const errorContent = verification.needsAuth ?
        `🔑 **Authentication Required**

${verification.error}

Please run \`check_auth_status\` and follow the authentication process.` :
        `❌ **Connection Failed**

${verification.error}

**Troubleshooting:**
- Verify PLEX_URL is correct and accessible
- Check if server is running and reachable
- Ensure network connectivity`;

      return {
        success: false,
        response: {
          content: [
            {
              type: 'text',
              text: errorContent
            }
          ],
          isError: true
        }
      };
    }

    return { success: true };
  }

  getHttpsAgent() {
    const verifySSL = process.env.PLEX_VERIFY_SSL !== 'false';
    const https = require('https');
    const tls = require('tls');

    return new https.Agent({
      rejectUnauthorized: verifySSL,
      minVersion: 'TLSv1.2',
      checkServerIdentity: (hostname, cert) => {
        // Always trust publicly verifiable certificates for *.*.plex.direct domains
        if (hostname.match(/^[^.]+\.[^.]+\.plex\.direct$/)) {
          // Let Node.js perform standard certificate verification
          // This allows publicly trusted certificates to work
          return undefined;
        }

        // Check if certificate is for a plex.direct domain (common case)
        // Plex servers always use plex.direct certificates regardless of hostname
        const certSubject = cert.subject?.CN || '';
        const certSANs = cert.subjectaltname || '';
        const isPlexDirectCert = certSubject.includes('plex.direct') || certSANs.includes('plex.direct');
        
        if (isPlexDirectCert && !verifySSL) {
          // Allow plex.direct certificates when SSL verification is disabled
          return undefined;
        }

        // For non-plex.direct domains, use default behavior
        if (verifySSL) {
          return tls.checkServerIdentity(hostname, cert);
        }

        // If SSL verification is disabled, skip all checks
        return undefined;
      }
    });
  }

  // ===========================
  // RANDOMIZATION HELPER METHODS
  // ===========================

  /**
   * Detect if a query suggests randomization is needed
   * @param {string} query - The search query to analyze
   * @returns {boolean} - True if randomization patterns detected
   */
  detectRandomizationIntent(query) {
    if (!query || typeof query !== 'string') { return false; }

    const randomPatterns = [
      // Direct randomization requests
      /\b(some|random|variety|mix|selection|surprise)\s+(songs?|tracks?|albums?|movies?|shows?|episodes?|music)/i,
      /\b(surprise\s+me|shuffle|mixed\s+bag|something\s+different)/i,
      /\b(pick|choose|select)\s+(some|a\s+few|several)/i,

      // Indefinite quantities suggesting variety
      /\b(some|any|various|assorted|different)\s+(songs?|tracks?|albums?|movies?|shows?|artists?)/i,
      /\b(give\s+me\s+)?(some|a\s+few|several)\b/i,

      // Discovery patterns
      /\b(discover|explore|find\s+me)\s+(new|different)/i,
      /\b(what|show\s+me)\s+(some|random)/i
    ];

    return randomPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Determine appropriate randomization settings based on query and content type
   * @param {string} query - The search query
   * @param {string} type - Content type (movie, show, track, etc.)
   * @param {Object} existingParams - Existing search parameters
   * @returns {Object} - Modified parameters with randomization settings
   */
  applyRandomizationSettings(query, type = null, existingParams = {}) {
    if (!this.detectRandomizationIntent(query)) {
      return existingParams;
    }

    const params = { ...existingParams };

    // Always use random sort when randomization is detected
    params.sort = 'random';

    // Adjust default limits for variety (unless user specified a specific limit)
    if (!params.limit || params.limit === 10) { // Default limits
      switch (type) {
        case 'track':
        case 'music':
          params.limit = Math.min(25, params.limit || 25); // More songs for variety
          break;
        case 'movie':
        case 'show':
          params.limit = Math.min(15, params.limit || 15); // Moderate for viewing
          break;
        case 'album':
        case 'artist':
          params.limit = Math.min(12, params.limit || 12); // Good album variety
          break;
        default:
          params.limit = Math.min(20, params.limit || 20); // General variety
      }
    }

    // For randomization, prefer to start from beginning (no offset)
    if (params.offset && params.offset > 0) {
      params.offset = 0;
    }

    return params;
  }

  /**
   * Apply client-side randomization when server-side isn't sufficient
   * @param {Array} items - Array of items to randomize
   * @param {number} maxItems - Maximum number of items to return
   * @returns {Array} - Shuffled subset of items
   */
  applyClientSideRandomization(items, maxItems = null) {
    if (!Array.isArray(items) || items.length === 0) {
      return items;
    }

    // Simple Fisher-Yates shuffle implementation
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Return subset if maxItems specified
    if (maxItems && maxItems < shuffled.length) {
      return shuffled.slice(0, maxItems);
    }

    return shuffled;
  }

  /**
   * Create a randomized subset from multiple categories
   * @param {Object} categorizedItems - Object with category keys and item arrays
   * @param {number} totalLimit - Total number of items to return
   * @returns {Array} - Mixed randomized results
   */
  createRandomizedMix(categorizedItems, totalLimit = 20) {
    const categories = Object.keys(categorizedItems);
    if (categories.length === 0) { return []; }

    const result = [];
    const itemsPerCategory = Math.floor(totalLimit / categories.length);
    const remainder = totalLimit % categories.length;

    // Get items from each category
    categories.forEach((category, index) => {
      const items = categorizedItems[category] || [];
      const categoryLimit = itemsPerCategory + (index < remainder ? 1 : 0);
      const randomItems = this.applyClientSideRandomization(items, categoryLimit);
      result.push(...randomItems);
    });

    // Final shuffle of the mixed results
    return this.applyClientSideRandomization(result);
  }

  /**
   * Generate random discovery suggestions when no specific query provided
   * @param {Array} libraries - Available libraries
   * @returns {Object} - Random discovery parameters
   */
  generateRandomDiscoveryParams(_libraries = []) {
    const _currentYear = new Date().getFullYear();
    const decades = ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
    const randomDecade = decades[Math.floor(Math.random() * decades.length)];

    const discoveryPatterns = [
      { query: `music from the ${randomDecade}`, limit: 15 },
      { query: 'highly rated albums', rating_min: 8, limit: 12 },
      { query: 'unheard songs', never_played: true, limit: 20 },
      { query: 'recent additions', sort: 'addedAt', limit: 15 },
      { query: 'forgotten favorites', play_count_min: 1, last_played_before: '2023-01-01', limit: 10 }
    ];

    const randomPattern = discoveryPatterns[Math.floor(Math.random() * discoveryPatterns.length)];
    return { ...randomPattern, sort: 'random' };
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async() => {
      return {
        tools: [
          {
            name: 'search_plex',
            description: 'Search for movies, TV shows, and other content in Plex libraries',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query (movie title, show name, etc.)'
                },
                type: {
                  type: 'string',
                  enum: ['movie', 'show', 'episode', 'artist', 'album', 'track'],
                  description: 'Type of content to search for (optional)'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 10)',
                  default: 10
                },
                play_count_min: {
                  type: 'number',
                  description: 'Minimum play count for results'
                },
                play_count_max: {
                  type: 'number',
                  description: 'Maximum play count for results'
                },
                last_played_after: {
                  type: 'string',
                  description: 'Filter items played after this date (YYYY-MM-DD format)'
                },
                last_played_before: {
                  type: 'string',
                  description: 'Filter items played before this date (YYYY-MM-DD format)'
                },
                played_in_last_days: {
                  type: 'number',
                  description: 'Filter items played in the last N days'
                },
                never_played: {
                  type: 'boolean',
                  description: 'Filter to only show never played items'
                },
                content_rating: {
                  type: 'string',
                  description: 'Filter by content rating (G, PG, PG-13, R, etc.)'
                },
                resolution: {
                  type: 'string',
                  enum: ['4k', '1080', '720', '480', 'sd'],
                  description: 'Filter by video resolution'
                },
                audio_format: {
                  type: 'string',
                  enum: ['lossless', 'lossy', 'mp3', 'flac', 'aac'],
                  description: 'Filter by audio format (for music)'
                },
                bpmMin: {
                  type: 'number',
                  description: 'Minimum BPM (beats per minute)'
                },
                bpmMax: {
                  type: 'number',
                  description: 'Maximum BPM (beats per minute)'
                },
                musical_key: {
                  type: 'string',
                  description: "Filter by musical key (e.g., 'C', 'G', 'Am', 'F#m')"
                },
                dynamic_range_min: {
                  type: 'number',
                  description: 'Minimum dynamic range in dB'
                },
                dynamic_range_max: {
                  type: 'number',
                  description: 'Maximum dynamic range in dB'
                },
                loudness_min: {
                  type: 'number',
                  description: 'Minimum loudness in LUFS'
                },
                loudness_max: {
                  type: 'number',
                  description: 'Maximum loudness in LUFS'
                },
                mood: {
                  type: 'string',
                  enum: ['energetic', 'calm', 'aggressive', 'melancholic', 'uplifting', 'dark', 'romantic', 'mysterious'],
                  description: 'Filter by mood/energy classification'
                },
                acoustic_ratio_min: {
                  type: 'number',
                  description: 'Minimum acoustic content ratio (0-1, where 1 is fully acoustic)'
                },
                acoustic_ratio_max: {
                  type: 'number',
                  description: 'Maximum acoustic content ratio (0-1, where 1 is fully acoustic)'
                },
                file_size_min: {
                  type: 'number',
                  description: 'Minimum file size in MB'
                },
                file_size_max: {
                  type: 'number',
                  description: 'Maximum file size in MB'
                },
                genre: {
                  type: 'string',
                  description: 'Filter by genre (e.g., Action, Comedy, Rock, Jazz)'
                },
                year: {
                  type: 'number',
                  description: 'Filter by release year'
                },
                year_min: {
                  type: 'number',
                  description: 'Filter by minimum release year'
                },
                year_max: {
                  type: 'number',
                  description: 'Filter by maximum release year'
                },
                studio: {
                  type: 'string',
                  description: 'Filter by studio/label (e.g., Warner Bros, Sony Music)'
                },
                director: {
                  type: 'string',
                  description: 'Filter by director name'
                },
                writer: {
                  type: 'string',
                  description: 'Filter by writer name'
                },
                actor: {
                  type: 'string',
                  description: 'Filter by actor/cast member name'
                },
                rating_min: {
                  type: 'number',
                  description: 'Minimum rating (0-10 scale)'
                },
                rating_max: {
                  type: 'number',
                  description: 'Maximum rating (0-10 scale)'
                },
                duration_min: {
                  type: 'number',
                  description: 'Minimum duration in minutes'
                },
                duration_max: {
                  type: 'number',
                  description: 'Maximum duration in minutes'
                },
                added_after: {
                  type: 'string',
                  description: 'Filter items added to library after this date (YYYY-MM-DD format)'
                },
                added_before: {
                  type: 'string',
                  description: 'Filter items added to library before this date (YYYY-MM-DD format)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'browse_libraries',
            description: 'List all available Plex libraries (Movies, TV Shows, Music, etc.)',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'browse_library',
            description: 'Browse content within a specific Plex library with filtering and sorting options',
            inputSchema: {
              type: 'object',
              properties: {
                library_id: {
                  type: 'string',
                  description: 'The library ID (key) to browse'
                },
                sort: {
                  type: 'string',
                  enum: ['titleSort', 'addedAt', 'originallyAvailableAt', 'rating', 'viewCount', 'lastViewedAt'],
                  description: 'Sort order (default: titleSort)',
                  default: 'titleSort'
                },
                genre: {
                  type: 'string',
                  description: 'Filter by genre'
                },
                year: {
                  type: 'number',
                  description: 'Filter by release year'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 20)',
                  default: 20
                },
                offset: {
                  type: 'number',
                  description: 'Number of results to skip (for pagination, default: 0)',
                  default: 0
                },
                play_count_min: {
                  type: 'number',
                  description: 'Minimum play count for results'
                },
                play_count_max: {
                  type: 'number',
                  description: 'Maximum play count for results'
                },
                last_played_after: {
                  type: 'string',
                  description: 'Filter items played after this date (YYYY-MM-DD format)'
                },
                last_played_before: {
                  type: 'string',
                  description: 'Filter items played before this date (YYYY-MM-DD format)'
                },
                played_in_last_days: {
                  type: 'number',
                  description: 'Filter items played in the last N days'
                },
                never_played: {
                  type: 'boolean',
                  description: 'Filter to only show never played items'
                },
                content_rating: {
                  type: 'string',
                  description: 'Filter by content rating (G, PG, PG-13, R, etc.)'
                },
                resolution: {
                  type: 'string',
                  enum: ['4k', '1080', '720', '480', 'sd'],
                  description: 'Filter by video resolution'
                },
                audio_format: {
                  type: 'string',
                  enum: ['lossless', 'lossy', 'mp3', 'flac', 'aac'],
                  description: 'Filter by audio format (for music)'
                },
                bpmMin: {
                  type: 'number',
                  description: 'Minimum BPM (beats per minute)'
                },
                bpmMax: {
                  type: 'number',
                  description: 'Maximum BPM (beats per minute)'
                },
                musical_key: {
                  type: 'string',
                  description: "Filter by musical key (e.g., 'C', 'G', 'Am', 'F#m')"
                },
                dynamic_range_min: {
                  type: 'number',
                  description: 'Minimum dynamic range in dB'
                },
                dynamic_range_max: {
                  type: 'number',
                  description: 'Maximum dynamic range in dB'
                },
                loudness_min: {
                  type: 'number',
                  description: 'Minimum loudness in LUFS'
                },
                loudness_max: {
                  type: 'number',
                  description: 'Maximum loudness in LUFS'
                },
                mood: {
                  type: 'string',
                  enum: ['energetic', 'calm', 'aggressive', 'melancholic', 'uplifting', 'dark', 'romantic', 'mysterious'],
                  description: 'Filter by mood/energy classification'
                },
                acoustic_ratio_min: {
                  type: 'number',
                  description: 'Minimum acoustic content ratio (0-1, where 1 is fully acoustic)'
                },
                acoustic_ratio_max: {
                  type: 'number',
                  description: 'Maximum acoustic content ratio (0-1, where 1 is fully acoustic)'
                },
                file_size_min: {
                  type: 'number',
                  description: 'Minimum file size in MB'
                },
                file_size_max: {
                  type: 'number',
                  description: 'Maximum file size in MB'
                },
                year_min: {
                  type: 'number',
                  description: 'Filter by minimum release year'
                },
                year_max: {
                  type: 'number',
                  description: 'Filter by maximum release year'
                },
                studio: {
                  type: 'string',
                  description: 'Filter by studio/label (e.g., Warner Bros, Sony Music)'
                },
                director: {
                  type: 'string',
                  description: 'Filter by director name'
                },
                writer: {
                  type: 'string',
                  description: 'Filter by writer name'
                },
                actor: {
                  type: 'string',
                  description: 'Filter by actor/cast member name'
                },
                rating_min: {
                  type: 'number',
                  description: 'Minimum rating (0-10 scale)'
                },
                rating_max: {
                  type: 'number',
                  description: 'Maximum rating (0-10 scale)'
                },
                duration_min: {
                  type: 'number',
                  description: 'Minimum duration in minutes'
                },
                duration_max: {
                  type: 'number',
                  description: 'Maximum duration in minutes'
                },
                added_after: {
                  type: 'string',
                  description: 'Filter items added to library after this date (YYYY-MM-DD format)'
                },
                added_before: {
                  type: 'string',
                  description: 'Filter items added to library before this date (YYYY-MM-DD format)'
                }
              },
              required: ['library_id']
            }
          },
          {
            name: 'get_recently_added',
            description: 'Get recently added content from Plex libraries',
            inputSchema: {
              type: 'object',
              properties: {
                library_id: {
                  type: 'string',
                  description: 'Specific library ID to get recent content from (optional, defaults to all libraries)'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 15)',
                  default: 15
                },
                chunk_size: {
                  type: 'number',
                  description: 'Number of items to return per chunk for pagination (optional)'
                },
                chunk_offset: {
                  type: 'number',
                  description: 'Offset for pagination, number of items to skip (optional)'
                }
              },
              required: []
            }
          },
          {
            name: 'get_watch_history',
            description: 'Get playback history for the Plex server',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of history items to return (default: 20)',
                  default: 20
                },
                account_id: {
                  type: 'string',
                  description: 'Filter by specific account/user ID (optional)'
                },
                chunk_size: {
                  type: 'number',
                  description: 'Number of items to return per chunk for pagination (optional)'
                },
                chunk_offset: {
                  type: 'number',
                  description: 'Offset for pagination, number of items to skip (optional)'
                }
              },
              required: []
            }
          },
          {
            name: 'get_on_deck',
            description: "Get 'On Deck' items (continue watching) for users",
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of items to return (default: 15)',
                  default: 15
                }
              },
              required: []
            }
          },
          {
            name: 'list_playlists',
            description: 'List all playlists on the Plex server',
            inputSchema: {
              type: 'object',
              properties: {
                playlist_type: {
                  type: 'string',
                  enum: ['audio', 'video', 'photo'],
                  description: 'Filter by playlist type (optional)'
                }
              },
              required: []
            }
          },
          {
            name: 'browse_playlist',
            description: 'Browse and view the contents of a specific playlist with full track metadata',
            inputSchema: {
              type: 'object',
              properties: {
                playlist_id: {
                  type: 'string',
                  description: 'The ID of the playlist to browse'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of items to return (default: 50)',
                  default: 50
                }
              },
              required: ['playlist_id']
            }
          },
          {
            name: 'create_playlist',
            description: 'Create a new regular playlist on the Plex server. Requires an initial item (item_key parameter) to be created successfully. Smart playlists are not supported due to their complex filter requirements.',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'The title/name for the new playlist'
                },
                type: {
                  type: 'string',
                  enum: ['audio', 'video', 'photo'],
                  description: 'The type of playlist to create'
                },
                item_key: {
                  type: 'string',
                  description: 'The key of an initial item to add to the playlist. Required for playlist creation. Get item keys from search_plex or browse_library results.'
                }
              },
              required: ['title', 'type', 'item_key']
            }
          },
          // TEMPORARILY DISABLED - Smart playlist filtering is broken
          // {
          //   name: "create_smart_playlist",
          //   description: "Create a new smart playlist with filter criteria. Smart playlists automatically populate based on specified conditions.",
          //   inputSchema: {
          //     type: "object",
          //     properties: {
          //       title: {
          //         type: "string",
          //         description: "The title/name for the new smart playlist",
          //       },
          //       type: {
          //         type: "string",
          //         enum: ["audio", "video", "photo"],
          //         description: "The type of content for the smart playlist",
          //       },
          //       library_id: {
          //         type: "string",
          //         description: "The library ID to create the smart playlist in. Use browse_libraries to get library IDs.",
          //       },
          //       filters: {
          //         type: "array",
          //         description: "Array of filter conditions for the smart playlist",
          //         items: {
          //           type: "object",
          //           properties: {
          //             field: {
          //               type: "string",
          //               enum: ["artist.title", "album.title", "track.title", "genre.tag", "year", "rating", "addedAt", "lastViewedAt", "viewCount"],
          //               description: "The field to filter on"
          //             },
          //             operator: {
          //               type: "string",
          //               enum: ["is", "isnot", "contains", "doesnotcontain", "beginswith", "endswith", "gt", "gte", "lt", "lte"],
          //               description: "The comparison operator"
          //             },
          //             value: {
          //               type: "string",
          //               description: "The value to compare against"
          //             }
          //           },
          //           required: ["field", "operator", "value"]
          //         },
          //         minItems: 1
          //       },
          //       sort: {
          //         type: "string",
          //         enum: ["artist.titleSort", "album.titleSort", "track.titleSort", "addedAt", "year", "rating", "lastViewedAt", "random"],
          //         description: "How to sort the smart playlist results (optional)",
          //         default: "artist.titleSort"
          //       },
          //       limit: {
          //         type: "integer",
          //         description: "Maximum number of items in the smart playlist (optional)",
          //         minimum: 1,
          //         maximum: 1000,
          //         default: 100
          //       }
          //     },
          //     required: ["title", "type", "library_id", "filters"],
          //   },
          // },
          {
            name: 'add_to_playlist',
            description: 'Add items to an existing playlist',
            inputSchema: {
              type: 'object',
              properties: {
                playlist_id: {
                  type: 'string',
                  description: 'The playlist ID (ratingKey) to add items to'
                },
                item_keys: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of item keys (ratingKey) to add to the playlist'
                }
              },
              required: ['playlist_id', 'item_keys']
            }
          },
          // DISABLED: remove_from_playlist - PROBLEMATIC due to Plex API limitations
          // This operation removes ALL instances of matching items, not just one
          // Uncomment only after implementing safer removal patterns
          /*
          {
            name: "remove_from_playlist",
            description: "Remove items from an existing playlist",
            inputSchema: {
              type: "object",
              properties: {
                playlist_id: {
                  type: "string",
                  description: "The playlist ID (ratingKey) to remove items from",
                },
                item_keys: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Array of item keys (ratingKey) to remove from the playlist",
                },
              },
              required: ["playlist_id", "item_keys"],
            },
          },
          */
          {
            name: 'delete_playlist',
            description: 'Delete an existing playlist',
            inputSchema: {
              type: 'object',
              properties: {
                playlist_id: {
                  type: 'string',
                  description: 'The playlist ID (ratingKey) to delete'
                }
              },
              required: ['playlist_id']
            }
          },
          {
            name: 'get_watched_status',
            description: 'Check watch status and progress for specific content items',
            inputSchema: {
              type: 'object',
              properties: {
                item_keys: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of item keys (ratingKey) to check watch status for'
                },
                account_id: {
                  type: 'string',
                  description: 'Specific account/user ID to check status for (optional)'
                }
              },
              required: ['item_keys']
            }
          },
          {
            name: 'get_collections',
            description: 'List all collections available on the Plex server',
            inputSchema: {
              type: 'object',
              properties: {
                library_id: {
                  type: 'string',
                  description: 'Filter collections by specific library ID (optional)'
                }
              },
              required: []
            }
          },
          {
            name: 'browse_collection',
            description: 'Browse content within a specific collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection_id: {
                  type: 'string',
                  description: 'The collection ID (ratingKey) to browse'
                },
                sort: {
                  type: 'string',
                  enum: ['titleSort', 'addedAt', 'originallyAvailableAt', 'rating', 'viewCount', 'lastViewedAt'],
                  description: 'Sort order (default: titleSort)',
                  default: 'titleSort'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 20)',
                  default: 20
                },
                offset: {
                  type: 'number',
                  description: 'Number of results to skip (for pagination, default: 0)',
                  default: 0
                }
              },
              required: ['collection_id']
            }
          },
          {
            name: 'get_media_info',
            description: 'Get detailed technical information about media files (codecs, bitrates, file sizes, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                item_key: {
                  type: 'string',
                  description: 'The item key (ratingKey) to get media information for'
                }
              },
              required: ['item_key']
            }
          },
          {
            name: 'get_library_stats',
            description: 'Get comprehensive statistics about Plex libraries (storage usage, file counts, content breakdown, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                library_id: {
                  type: 'string',
                  description: 'Specific library ID to get stats for (optional, defaults to all libraries)'
                },
                include_details: {
                  type: 'boolean',
                  description: 'Include detailed breakdowns by file type, resolution, codec, etc. (default: false)',
                  default: false
                }
              },
              required: []
            }
          },
          {
            name: 'get_listening_stats',
            description: 'Get detailed listening statistics and music recommendations based on play history and patterns',
            inputSchema: {
              type: 'object',
              properties: {
                account_id: {
                  type: 'string',
                  description: 'Specific account/user ID to analyze (optional, defaults to all users)'
                },
                time_period: {
                  type: 'string',
                  enum: ['week', 'month', 'quarter', 'year', 'all'],
                  description: 'Time period to analyze (default: month)',
                  default: 'month'
                },
                include_recommendations: {
                  type: 'boolean',
                  description: 'Include music recommendations based on listening patterns (default: true)',
                  default: true
                },
                music_library_id: {
                  type: 'string',
                  description: 'Specific music library ID to analyze (optional, auto-detects music libraries)'
                }
              },
              required: []
            }
          },
          {
            name: 'discover_music',
            description: 'Natural language music discovery with smart recommendations based on your preferences and library',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "Natural language query (e.g., 'songs from the 90s', 'rock bands I haven't heard', 'something like Modest Mouse')"
                },
                context: {
                  type: 'string',
                  description: 'Additional context for the search (optional)'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 10)',
                  default: 10
                }
              },
              required: ['query']
            }
          },
          {
            name: 'authenticate_plex',
            description: 'Initiate Plex OAuth authentication flow to get user login URL',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'check_auth_status',
            description: 'Check if Plex authentication is complete and retrieve the auth token',
            inputSchema: {
              type: 'object',
              properties: {
                pin_id: {
                  type: 'string',
                  description: 'Optional pin ID to check. If not provided, uses the last requested pin.'
                }
              },
              required: []
            }
          },
          {
            name: 'clear_auth',
            description: 'Clear stored authentication credentials',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async(request) => {
      switch (request.params.name) {
        case 'search_plex':
          return await this.handlePlexSearch(request.params.arguments);
        case 'browse_libraries':
          return await this.handleBrowseLibraries(request.params.arguments);
        case 'browse_library':
          return await this.handleBrowseLibrary(request.params.arguments);
        case 'get_recently_added':
          return await this.handleRecentlyAdded(request.params.arguments);
        case 'get_watch_history':
          return await this.handleWatchHistory(request.params.arguments);
        case 'get_on_deck':
          return await this.handleOnDeck(request.params.arguments);
        case 'list_playlists':
          return await this.handleListPlaylists(request.params.arguments);
        case 'browse_playlist':
          return await this.handleBrowsePlaylist(request.params.arguments);
        case 'create_playlist':
          return await this.handleCreatePlaylist(request.params.arguments);
        // TEMPORARILY DISABLED - Smart playlist filtering is broken
        // case "create_smart_playlist":
        //   return await this.handleCreateSmartPlaylist(request.params.arguments);
        case 'add_to_playlist':
          return await this.handleAddToPlaylist(request.params.arguments);
        // DISABLED: remove_from_playlist - PROBLEMATIC operation
        // case "remove_from_playlist":
        //   return await this.handleRemoveFromPlaylist(request.params.arguments);
        case 'delete_playlist':
          return await this.handleDeletePlaylist(request.params.arguments);
        case 'get_watched_status':
          return await this.handleWatchedStatus(request.params.arguments);
        case 'get_collections':
          return await this.handleGetCollections(request.params.arguments);
        case 'browse_collection':
          return await this.handleBrowseCollection(request.params.arguments);
        case 'get_media_info':
          return await this.handleGetMediaInfo(request.params.arguments);
        case 'get_library_stats':
          return await this.handleGetLibraryStats(request.params.arguments);
        case 'get_listening_stats':
          return await this.handleGetListeningStats(request.params.arguments);
        case 'discover_music':
          return await this.handleDiscoverMusic(request.params.arguments);
        case 'authenticate_plex':
          return await this.handleAuthenticatePlex(request.params.arguments);
        case 'check_auth_status':
          return await this.handleCheckAuthStatus(request.params.arguments);
        case 'clear_auth':
          return await this.handleClearAuth(request.params.arguments);
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }

  async handleAuthenticatePlex(_args) {
    try {
      const { loginUrl, pinId } = await this.authManager.requestAuthUrl();

      return {
        content: [
          {
            type: 'text',
            text: `Plex Authentication Started

**Next Steps:**
1. Open this URL in your browser:

\`\`\`
${loginUrl.replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/!/g, '%21')}
\`\`\`

2. Sign into your Plex account when prompted
3. **IMPORTANT:** After signing in, you MUST return here and run the \`check_auth_status\` tool to complete the authentication process
4. Only after running \`check_auth_status\` will your token be saved and ready for use

**Pin ID:** ${pinId}

⚠️ **Don't forget:** The authentication is not complete until you return and run \`check_auth_status\`!`
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Authentication Error: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handleCheckAuthStatus(args) {
    const { pin_id } = args;

    try {
      const authToken = await this.authManager.checkAuthToken(pin_id);

      if (authToken) {
        this.connectionVerified = false; // Reset so next tool use will verify the new token
        return {
          content: [
            {
              type: 'text',
              text: `✅ Plex Authentication Successful!

Your authentication token has been stored and will be used for all Plex API requests. You can now use all Plex tools without needing the PLEX_TOKEN environment variable.

**Note:** This token is stored only for this session. For persistent authentication, consider setting the PLEX_TOKEN environment variable.`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `⏳ Authentication Pending

The user has not yet completed the authentication process. Please:

1. Make sure you've visited the login URL from the authenticate_plex tool
2. Sign into your Plex account in the browser
3. Try checking the auth status again in a few moments

You can run check_auth_status again to check if authentication is complete.`
            }
          ]
        };
      }
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Auth Status Check Error: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handleClearAuth(_args) {
    try {
      await this.authManager.clearAuth();
      this.connectionVerified = false; // Reset connection verification

      return {
        content: [
          {
            type: 'text',
            text: `🔄 Authentication Cleared

All stored authentication credentials have been cleared. To use Plex tools again, you'll need to either:

1. Set the PLEX_TOKEN environment variable, or
2. Run the authenticate_plex tool to sign in again`
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Clear Auth Error: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handlePlexSearch(args) {
    // Verify connection before proceeding
    const connectionCheck = await this.ensureConnection();
    if (!connectionCheck.success) {
      return connectionCheck.response;
    }

    const {
      query,
      type,
      limit = 10,
      play_count_min,
      play_count_max,
      last_played_after,
      last_played_before,
      played_in_last_days,
      never_played,
      content_rating,
      resolution,
      audio_format,
      bpmMin,
      bpmMax,
      musical_key,
      dynamic_range_min,
      dynamic_range_max,
      loudness_min,
      loudness_max,
      mood,
      acoustic_ratio_min,
      acoustic_ratio_max,
      file_size_min,
      file_size_max,
      genre,
      year,
      year_min,
      year_max,
      studio,
      director,
      writer,
      actor,
      rating_min,
      rating_max,
      duration_min,
      duration_max,
      added_after,
      added_before
    } = args;

    // Apply randomization settings if detected
    const enhancedArgs = this.applyRandomizationSettings(query, type, args);
    const finalLimit = enhancedArgs.limit || limit;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const searchUrl = `${plexUrl}/hubs/search`;
      const params = {
        query: query,
        'X-Plex-Token': plexToken,
        limit: finalLimit
      };

      if (type) {
        params.type = this.getPlexTypeNumber(type);
      }

      const response = await this.axios.get(searchUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      let results = this.parseSearchResults(response.data);

      // Apply activity filters
      results = this.applyActivityFilters(results, {
        play_count_min,
        play_count_max,
        last_played_after,
        last_played_before,
        played_in_last_days,
        never_played
      });

      // Apply basic content filters
      results = this.applyBasicFilters(results, {
        genre,
        year,
        year_min,
        year_max,
        studio,
        director,
        writer,
        actor,
        rating_min,
        rating_max,
        duration_min,
        duration_max,
        added_after,
        added_before
      });

      // Apply advanced filters
      results = this.applyAdvancedFilters(results, {
        content_rating,
        resolution,
        audio_format,
        bpmMin,
        bpmMax,
        musical_key,
        dynamic_range_min,
        dynamic_range_max,
        loudness_min,
        loudness_max,
        mood,
        acoustic_ratio_min,
        acoustic_ratio_max,
        file_size_min,
        file_size_max
      });

      // Apply client-side randomization if detected and we have more results than requested
      const shouldRandomize = this.detectRandomizationIntent(query);
      if (shouldRandomize && results.length > limit) {
        results = this.applyClientSideRandomization(results, limit);
      }

      const resultText = shouldRandomize && results.length > 0 ?
        `Found ${results.length} randomized results for "${query}":\n\n${this.formatResults(results)}` :
        `Found ${results.length} results for "${query}":\n\n${this.formatResults(results)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching Plex: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  getPlexTypeNumber(type) {
    const typeMap = {
      movie: 1,
      show: 2,
      episode: 4,
      artist: 8,
      album: 9,
      track: 10
    };
    return typeMap[type] || null;
  }

  parseSearchResults(data) {
    if (!data.MediaContainer) {
      return [];
    }

    // Handle both /search and /hubs/search response formats
    let allResults = [];

    // For /hubs/search response format (contains Hub elements)
    if (data.MediaContainer.Hub) {
      const hubs = Array.isArray(data.MediaContainer.Hub) ? data.MediaContainer.Hub : [data.MediaContainer.Hub];

      for (const hub of hubs) {
        if (hub.Metadata) {
          const hubResults = Array.isArray(hub.Metadata) ? hub.Metadata : [hub.Metadata];
          allResults = allResults.concat(hubResults);
        }
      }
    } else if (data.MediaContainer.Metadata) {
      // For /search response format (direct Metadata array)
      allResults = Array.isArray(data.MediaContainer.Metadata) ? data.MediaContainer.Metadata : [data.MediaContainer.Metadata];
    }

    return allResults.map(item => ({
      title: item.title,
      type: item.type,
      year: item.year,
      summary: item.summary,
      rating: item.rating,
      duration: item.duration,
      addedAt: item.addedAt,
      viewCount: item.viewCount,
      lastViewedAt: item.lastViewedAt,
      contentRating: item.contentRating,
      Media: item.Media,
      key: item.key,
      ratingKey: item.ratingKey, // Critical: the unique identifier for playlist operations
      // Additional hierarchical info for music tracks
      parentTitle: item.parentTitle, // Album name
      grandparentTitle: item.grandparentTitle, // Artist name
      parentRatingKey: item.parentRatingKey, // Album ID
      grandparentRatingKey: item.grandparentRatingKey, // Artist ID
      // Additional metadata for basic filters
      studio: item.studio,
      genres: item.Genre ? item.Genre.map(g => g.tag) : [],
      directors: item.Director ? item.Director.map(d => d.tag) : [],
      writers: item.Writer ? item.Writer.map(w => w.tag) : [],
      actors: item.Role ? item.Role.map(r => r.tag) : []
    }));
  }

  formatResults(results) {
    return results.map((item, index) => {
      let formatted = `${index + 1}. **${item.title}**`;

      if (item.year) {
        formatted += ` (${item.year})`;
      }

      if (item.type) {
        formatted += ` - ${item.type}`;
      }

      // Add artist/album info for music tracks
      if (item.grandparentTitle && item.parentTitle) {
        formatted += `\n   Artist: ${item.grandparentTitle} | Album: ${item.parentTitle}`;
      } else if (item.parentTitle) {
        formatted += `\n   Album/Show: ${item.parentTitle}`;
      }

      if (item.rating) {
        formatted += `\n   Rating: ${item.rating}`;
      }

      if (item.duration) {
        formatted += `\n   Duration: ${this.formatDuration(item.duration)}`;
      }

      // CRITICAL: Show the ratingKey for playlist operations
      if (item.ratingKey) {
        formatted += `\n   **ID: ${item.ratingKey}** (use this for playlists)`;
      }

      if (item.summary) {
        formatted += `\n   ${item.summary.substring(0, 150)}${item.summary.length > 150 ? '...' : ''}`;
      }

      return formatted;
    }).join('\n\n');
  }

  formatDuration(milliseconds) {
    if (!milliseconds || milliseconds === 0) { return 'Unknown'; }

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  async handleBrowseLibraries(_args) {
    // Verify connection before proceeding
    const connectionCheck = await this.ensureConnection();
    if (!connectionCheck.success) {
      return connectionCheck.response;
    }

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const librariesUrl = `${plexUrl}/library/sections`;
      const params = {
        'X-Plex-Token': plexToken
      };

      const response = await this.axios.get(librariesUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const libraries = this.parseLibraries(response.data);

      return {
        content: [
          {
            type: 'text',
            text: `Available Plex Libraries:\n\n${this.formatLibraries(libraries)}`
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error browsing libraries: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseLibraries(data) {
    if (!data.MediaContainer || !data.MediaContainer.Directory) {
      return [];
    }

    return data.MediaContainer.Directory.map(library => ({
      key: library.key,
      title: library.title,
      type: library.type,
      agent: library.agent,
      scanner: library.scanner,
      language: library.language,
      refreshing: library.refreshing,
      createdAt: library.createdAt,
      updatedAt: library.updatedAt,
      scannedAt: library.scannedAt
    }));
  }

  formatLibraries(libraries) {
    return libraries.map((library, index) => {
      let formatted = `${index + 1}. **${library.title}** (${library.type})`;

      if (library.agent) {
        formatted += `\n   Agent: ${library.agent}`;
      }

      if (library.language) {
        formatted += ` | Language: ${library.language}`;
      }

      if (library.scannedAt) {
        const scannedDate = new Date(library.scannedAt * 1000).toLocaleDateString();
        formatted += `\n   Last scanned: ${scannedDate}`;
      }

      formatted += `\n   Library ID: ${library.key}`;

      return formatted;
    }).join('\n\n');
  }

  async handleBrowseLibrary(args) {
    const {
      library_id,
      sort = 'titleSort',
      genre,
      year,
      limit = 20,
      offset = 0,
      play_count_min,
      play_count_max,
      last_played_after,
      last_played_before,
      played_in_last_days,
      never_played,
      content_rating,
      resolution,
      audio_format,
      bpmMin,
      bpmMax,
      musical_key,
      dynamic_range_min,
      dynamic_range_max,
      loudness_min,
      loudness_max,
      mood,
      acoustic_ratio_min,
      acoustic_ratio_max,
      file_size_min,
      file_size_max,
      year_min,
      year_max,
      studio,
      director,
      writer,
      actor,
      rating_min,
      rating_max,
      duration_min,
      duration_max,
      added_after,
      added_before
    } = args;

    // Apply randomization settings if detected (for browse library, check genre as potential query)
    const searchQuery = genre || year || 'browse';
    const enhancedArgs = this.applyRandomizationSettings(searchQuery, null, args);
    const finalSort = enhancedArgs.sort || sort;
    const finalLimit = enhancedArgs.limit || limit;
    const finalOffset = enhancedArgs.offset !== undefined ? enhancedArgs.offset : offset;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const libraryUrl = `${plexUrl}/library/sections/${library_id}/all`;
      const params = {
        'X-Plex-Token': plexToken,
        sort: finalSort,
        'X-Plex-Container-Start': finalOffset,
        'X-Plex-Container-Size': finalLimit
      };

      if (genre) {
        params.genre = genre;
      }

      if (year) {
        params.year = year;
      }

      const response = await this.axios.get(libraryUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      let results = this.parseLibraryContent(response.data);

      // Apply activity filters
      results = this.applyActivityFilters(results, {
        play_count_min,
        play_count_max,
        last_played_after,
        last_played_before,
        played_in_last_days,
        never_played
      });

      // Apply basic content filters
      results = this.applyBasicFilters(results, {
        genre,
        year,
        year_min,
        year_max,
        studio,
        director,
        writer,
        actor,
        rating_min,
        rating_max,
        duration_min,
        duration_max,
        added_after,
        added_before
      });

      // Apply advanced filters
      results = this.applyAdvancedFilters(results, {
        content_rating,
        resolution,
        audio_format,
        bpmMin,
        bpmMax,
        musical_key,
        dynamic_range_min,
        dynamic_range_max,
        loudness_min,
        loudness_max,
        mood,
        acoustic_ratio_min,
        acoustic_ratio_max,
        file_size_min,
        file_size_max
      });

      // Apply client-side randomization if detected and using random sort
      const shouldRandomize = this.detectRandomizationIntent(searchQuery);
      if (shouldRandomize && finalSort === 'random' && results.length > limit) {
        results = this.applyClientSideRandomization(results, limit);
      }

      const totalSize = response.data.MediaContainer?.totalSize || results.length;

      let resultText = shouldRandomize && finalSort === 'random' ?
        `Randomized library content (${results.length} items)` :
        `Library content (${finalOffset + 1}-${Math.min(finalOffset + finalLimit, totalSize)} of ${totalSize})`;
      if (genre) { resultText += ` | Genre: ${genre}`; }
      if (year) { resultText += ` | Year: ${year}`; }
      if (finalSort !== 'titleSort') { resultText += ` | Sorted by: ${finalSort}`; }
      resultText += `:\n\n${this.formatResults(results)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error browsing library: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseLibraryContent(data) {
    if (!data.MediaContainer || !data.MediaContainer.Metadata) {
      return [];
    }

    return data.MediaContainer.Metadata.map(item => ({
      title: item.title,
      type: item.type,
      year: item.year,
      summary: item.summary,
      rating: item.rating,
      duration: item.duration,
      addedAt: item.addedAt,
      originallyAvailableAt: item.originallyAvailableAt,
      viewCount: item.viewCount,
      lastViewedAt: item.lastViewedAt,
      genres: item.Genre?.map(g => g.tag) || [],
      key: item.key,
      // Additional metadata for basic filters
      studio: item.studio,
      directors: item.Director ? item.Director.map(d => d.tag) : [],
      writers: item.Writer ? item.Writer.map(w => w.tag) : [],
      actors: item.Role ? item.Role.map(r => r.tag) : []
    }));
  }

  async handleRecentlyAdded(args) {
    const { library_id, limit = 15, chunk_size = 10, chunk_offset = 0 } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      let recentUrl;
      if (library_id) {
        recentUrl = `${plexUrl}/library/sections/${library_id}/recentlyAdded`;
      } else {
        recentUrl = `${plexUrl}/library/recentlyAdded`;
      }

      const params = {
        'X-Plex-Token': plexToken,
        'X-Plex-Container-Size': limit
      };

      const response = await this.axios.get(recentUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const results = this.parseLibraryContent(response.data);

      // Apply chunking
      const totalResults = results.length;
      const start = chunk_offset;
      const end = Math.min(start + chunk_size, totalResults);
      const chunkedResults = results.slice(start, end);

      let resultText = 'Recently added content';
      if (library_id) { resultText += ` from library ${library_id}`; }
      resultText += ` (showing ${start + 1}-${end} of ${totalResults} items)`;

      if (totalResults > chunk_size) {
        const hasMore = end < totalResults;
        const hasPrevious = start > 0;
        resultText += '\n📄 Pagination: ';
        if (hasPrevious) { resultText += `Previous available (offset: ${Math.max(0, start - chunk_size)}) | `; }
        if (hasMore) { resultText += `Next available (offset: ${end})`; }
      }

      resultText += `:\n\n${this.formatRecentlyAdded(chunkedResults)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting recently added content: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  formatRecentlyAdded(results) {
    return results.map((item, index) => {
      let formatted = `${index + 1}. **${item.title}**`;

      if (item.year) {
        formatted += ` (${item.year})`;
      }

      if (item.type) {
        formatted += ` - ${item.type}`;
      }

      if (item.addedAt) {
        const addedDate = new Date(item.addedAt * 1000).toLocaleDateString();
        formatted += ` - Added: ${addedDate}`;
      }

      if (item.genres && item.genres.length > 0) {
        formatted += `\n   Genres: ${item.genres.slice(0, 3).join(', ')}`;
      }

      if (item.summary) {
        formatted += `\n   ${item.summary.substring(0, 120)}${item.summary.length > 120 ? '...' : ''}`;
      }

      return formatted;
    }).join('\n\n');
  }

  async handleWatchHistory(args) {
    const { limit = 20, account_id, chunk_size = 10, chunk_offset = 0 } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const historyUrl = `${plexUrl}/status/sessions/history/all`;
      const params = {
        'X-Plex-Token': plexToken,
        'X-Plex-Container-Size': limit
      };

      if (account_id) {
        params.accountID = account_id;
      }

      const response = await this.axios.get(historyUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const results = this.parseWatchHistory(response.data);

      // Apply chunking
      const totalResults = results.length;
      const start = chunk_offset;
      const end = Math.min(start + chunk_size, totalResults);
      const chunkedResults = results.slice(start, end);

      let resultText = 'Watch history';
      if (account_id) { resultText += ` for account ${account_id}`; }
      resultText += ` (showing ${start + 1}-${end} of ${totalResults} items)`;

      if (totalResults > chunk_size) {
        const hasMore = end < totalResults;
        const hasPrevious = start > 0;
        resultText += '\n📄 Pagination: ';
        if (hasPrevious) { resultText += `Previous available (offset: ${Math.max(0, start - chunk_size)}) | `; }
        if (hasMore) { resultText += `Next available (offset: ${end})`; }
      }

      resultText += `:\n\n${this.formatWatchHistory(chunkedResults)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting watch history: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseWatchHistory(data) {
    if (!data.MediaContainer || !data.MediaContainer.Metadata) {
      return [];
    }

    return data.MediaContainer.Metadata.map(item => ({
      title: item.title,
      type: item.type,
      year: item.year,
      viewedAt: item.viewedAt,
      accountID: item.accountID,
      deviceID: item.deviceID,
      viewOffset: item.viewOffset,
      duration: item.duration,
      grandparentTitle: item.grandparentTitle, // TV show name
      parentTitle: item.parentTitle, // Season name
      index: item.index, // Episode number
      parentIndex: item.parentIndex, // Season number
      key: item.key
    }));
  }

  formatWatchHistory(results) {
    return results.map((item, index) => {
      let formatted = `${index + 1}. **${item.title}**`;

      if (item.grandparentTitle) {
        formatted = `${index + 1}. **${item.grandparentTitle}**`;
        if (item.parentIndex) { formatted += ` S${item.parentIndex}`; }
        if (item.index) { formatted += `E${item.index}`; }
        formatted += ` - ${item.title}`;
      }

      if (item.year) {
        formatted += ` (${item.year})`;
      }

      if (item.viewedAt) {
        const viewedDate = new Date(item.viewedAt * 1000);
        formatted += `\n   Watched: ${viewedDate.toLocaleString()}`;
      }

      if (item.viewOffset && item.duration) {
        const progress = Math.round((item.viewOffset / item.duration) * 100);
        formatted += ` | Progress: ${progress}%`;
      }

      if (item.deviceID) {
        formatted += `\n   Device: ${item.deviceID}`;
      }

      return formatted;
    }).join('\n\n');
  }

  async handleOnDeck(args) {
    const { limit = 15 } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const onDeckUrl = `${plexUrl}/library/onDeck`;
      const params = {
        'X-Plex-Token': plexToken,
        'X-Plex-Container-Size': limit
      };

      const response = await this.axios.get(onDeckUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const results = this.parseOnDeck(response.data);

      const resultText = `On Deck (Continue Watching) - ${results.length} items:\n\n${this.formatOnDeck(results)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting On Deck items: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseOnDeck(data) {
    if (!data.MediaContainer || !data.MediaContainer.Metadata) {
      return [];
    }

    return data.MediaContainer.Metadata.map(item => ({
      title: item.title,
      type: item.type,
      year: item.year,
      viewOffset: item.viewOffset,
      duration: item.duration,
      lastViewedAt: item.lastViewedAt,
      grandparentTitle: item.grandparentTitle,
      parentTitle: item.parentTitle,
      index: item.index,
      parentIndex: item.parentIndex,
      summary: item.summary,
      rating: item.rating,
      key: item.key
    }));
  }

  formatOnDeck(results) {
    return results.map((item, index) => {
      let formatted = `${index + 1}. **${item.title}**`;

      if (item.grandparentTitle) {
        formatted = `${index + 1}. **${item.grandparentTitle}**`;
        if (item.parentIndex) { formatted += ` S${item.parentIndex}`; }
        if (item.index) { formatted += `E${item.index}`; }
        formatted += ` - ${item.title}`;
      }

      if (item.year) {
        formatted += ` (${item.year})`;
      }

      if (item.viewOffset && item.duration) {
        const progress = Math.round((item.viewOffset / item.duration) * 100);
        const remainingMinutes = Math.round((item.duration - item.viewOffset) / 60000);
        formatted += `\n   Progress: ${progress}% | ${remainingMinutes} min remaining`;
      }

      if (item.lastViewedAt) {
        const lastViewed = new Date(item.lastViewedAt * 1000);
        formatted += `\n   Last watched: ${lastViewed.toLocaleDateString()}`;
      }

      if (item.summary) {
        formatted += `\n   ${item.summary.substring(0, 100)}${item.summary.length > 100 ? '...' : ''}`;
      }

      return formatted;
    }).join('\n\n');
  }

  async handleListPlaylists(args) {
    const { playlist_type } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const playlistsUrl = `${plexUrl}/playlists`;
      const params = {
        'X-Plex-Token': plexToken
      };

      if (playlist_type) {
        params.playlistType = playlist_type;
      }

      const response = await this.axios.get(playlistsUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const playlists = this.parsePlaylists(response.data);

      let resultText = 'Playlists';
      if (playlist_type) { resultText += ` (${playlist_type})`; }
      resultText += ` - ${playlists.length} found:\n\n${this.formatPlaylists(playlists)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing playlists: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handleBrowsePlaylist(args) {
    const { playlist_id, limit = 50 } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // First get playlist info
      const playlistUrl = `${plexUrl}/playlists/${playlist_id}`;
      const response = await this.axios.get(playlistUrl, {
        params: {
          'X-Plex-Token': plexToken,
          'X-Plex-Container-Start': 0,
          'X-Plex-Container-Size': limit || 50
        },
        httpsAgent: this.getHttpsAgent()
      });

      const playlistData = response.data.MediaContainer;
      if (!playlistData || !playlistData.Metadata || playlistData.Metadata.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Playlist with ID ${playlist_id} not found`
            }
          ]
        };
      }

      const playlist = playlistData.Metadata[0];

      // Try to get items from the current response first
      let items = playlistData.Metadata[0].Metadata || [];

      // If no items found, try the /items endpoint specifically
      if (items.length === 0 && playlist.leafCount && playlist.leafCount > 0) {
        try {
          const itemsUrl = `${plexUrl}/playlists/${playlist_id}/items`;
          const itemsResponse = await this.axios.get(itemsUrl, {
            params: {
              'X-Plex-Token': plexToken,
              'X-Plex-Container-Start': 0,
              'X-Plex-Container-Size': limit || 50
            },
            httpsAgent: this.getHttpsAgent()
          });

          const itemsData = itemsResponse.data.MediaContainer;
          if (itemsData && itemsData.Metadata) {
            items = itemsData.Metadata;
          }
        } catch (itemsError) {
          console.error(`Failed to fetch playlist items via /items endpoint: ${itemsError.message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Error retrieving playlist items: ${itemsError.message}`
              }
            ]
          };
        }
      }

      // Limit results if specified
      const limitedItems = limit ? items.slice(0, limit) : items;

      let resultText = `**${playlist.title}**`;
      if (playlist.smart) {
        resultText += ' (Smart Playlist)';
      }
      resultText += '\n';
      if (playlist.summary) {
        resultText += `${playlist.summary}\n`;
      }
      resultText += `Duration: ${this.formatDuration(playlist.duration || 0)}\n`;
      resultText += `Items: ${items.length}`;
      if (limit && items.length > limit) {
        resultText += ` (showing first ${limit})`;
      }
      resultText += '\n\n';

      if (limitedItems.length === 0) {
        resultText += 'This playlist appears to be empty or items could not be retrieved.';
      } else {
        resultText += limitedItems.map((item, index) => {
          let itemText = `${index + 1}. **${item.title}**`;

          // Add artist/album info for music
          if (item.grandparentTitle && item.parentTitle) {
            itemText += `\n   Artist: ${item.grandparentTitle}\n   Album: ${item.parentTitle}`;
          } else if (item.parentTitle) {
            itemText += `\n   Album/Show: ${item.parentTitle}`;
          }

          // Add duration
          if (item.duration) {
            itemText += `\n   Duration: ${this.formatDuration(item.duration)}`;
          }

          // Add rating key for identification
          itemText += `\n   ID: ${item.ratingKey}`;

          // Add media type
          const mediaType = this.getMediaTypeFromItem(item);
          if (mediaType) {
            itemText += `\n   Type: ${mediaType}`;
          }

          return itemText;
        }).join('\n\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error browsing playlist: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  getMediaTypeFromItem(item) {
    if (item.type === 'track') { return 'Music Track'; }
    if (item.type === 'episode') { return 'TV Episode'; }
    if (item.type === 'movie') { return 'Movie'; }
    if (item.type === 'artist') { return 'Artist'; }
    if (item.type === 'album') { return 'Album'; }
    return item.type || 'Unknown';
  }

  parsePlaylists(data) {
    if (!data.MediaContainer || !data.MediaContainer.Metadata) {
      return [];
    }

    return data.MediaContainer.Metadata.map(playlist => ({
      ratingKey: playlist.ratingKey,
      key: playlist.key,
      title: playlist.title,
      type: playlist.type,
      playlistType: playlist.playlistType,
      smart: playlist.smart,
      duration: playlist.duration,
      leafCount: playlist.leafCount,
      addedAt: playlist.addedAt,
      updatedAt: playlist.updatedAt,
      composite: playlist.composite
    }));
  }

  formatPlaylists(playlists) {
    return playlists.map((playlist, index) => {
      let formatted = `${index + 1}. **${playlist.title}**`;

      if (playlist.playlistType) {
        formatted += ` (${playlist.playlistType})`;
      }

      if (playlist.smart) {
        formatted += ' - Smart Playlist';
      }

      if (playlist.leafCount) {
        formatted += `\n   Items: ${playlist.leafCount}`;
      }

      if (playlist.duration) {
        const hours = Math.floor(playlist.duration / 3600000);
        const minutes = Math.floor((playlist.duration % 3600000) / 60000);
        if (hours > 0) {
          formatted += ` | Duration: ${hours}h ${minutes}m`;
        } else {
          formatted += ` | Duration: ${minutes}m`;
        }
      }

      if (playlist.updatedAt) {
        const updatedDate = new Date(playlist.updatedAt * 1000).toLocaleDateString();
        formatted += `\n   Last updated: ${updatedDate}`;
      }

      formatted += `\n   Playlist ID: ${playlist.ratingKey}`;

      return formatted;
    }).join('\n\n');
  }

  async handleCreatePlaylist(args) {
    const { title, type, item_key, smart = false } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // First get server info to get machine identifier
      const serverResponse = await this.axios.get(`${plexUrl}/`, {
        headers: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent()
      });

      const machineIdentifier = serverResponse.data?.MediaContainer?.machineIdentifier;
      if (!machineIdentifier) {
        throw new Error('Could not get server machine identifier');
      }

      const params = new URLSearchParams({
        title: title,
        type: type,
        smart: smart ? '1' : '0'
      });

      // Add URI if item_key is provided
      if (item_key) {
        const uri = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${item_key}`;
        params.append('uri', uri);
      }

      // Add required Plex headers as query parameters
      params.append('X-Plex-Token', plexToken);
      params.append('X-Plex-Product', 'Plex MCP');
      params.append('X-Plex-Version', '1.0.0');
      params.append('X-Plex-Client-Identifier', 'plex-mcp-client');
      params.append('X-Plex-Platform', 'Node.js');

      const createUrl = `${plexUrl}/playlists?${params.toString()}`;

      const response = await this.axios.post(createUrl, null, {
        headers: {
          'Content-Length': '0'
        },
        httpsAgent: this.getHttpsAgent()
      });

      // Get the created playlist info from the response
      const playlistData = response.data?.MediaContainer?.Metadata?.[0];

      let resultText = `✅ Successfully created ${smart ? 'smart ' : ''}playlist: **${title}**`;
      if (playlistData) {
        resultText += `\n   **Playlist ID: ${playlistData.ratingKey}** (use this ID for future operations)`;
        resultText += `\n   Type: ${type}`;
        if (smart) { resultText += '\n   Smart Playlist: Yes'; }
        if (item_key && !smart) {
          resultText += `\n   Initial item added: ${item_key}`;
        }
      } else {
        resultText += '\n   ⚠️ Playlist created but details not available - check your playlists';
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      let errorMessage = `Error creating playlist: ${_error.message}`;

      // Check if it's a 400 Bad Request error
      if (_error.response && _error.response.status === 400) {
        errorMessage = `Playlist creation failed with 400 Bad Request. This may indicate that:
1. The Plex server doesn't support playlist creation via API
2. Additional parameters are required that aren't documented  
3. Playlists may need to be created through the Plex web interface

You can try creating the playlist manually in Plex and then use other MCP tools to manage it.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      };
    }
  }

  async handleCreateSmartPlaylist(args) {
    const { title, type, library_id, filters, sort: _sort = 'artist.titleSort', limit: _limit = 100 } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // Get server machine identifier
      const serverResponse = await this.axios.get(`${plexUrl}`, {
        headers: {
          'X-Plex-Token': plexToken,
          Accept: 'application/json'
        },
        httpsAgent: this.getHttpsAgent()
      });

      const machineId = serverResponse.data.MediaContainer.machineIdentifier;

      // Build query parameters from filters manually to avoid double encoding
      const queryParts = [`type=${type === 'audio' ? '10' : '1'}`];

      filters.forEach(filter => {
        const field = this.mapFilterField(filter.field);
        const operator = this.mapFilterOperator(filter.operator);

        if (operator === '=') {
          // Plex expects triple-encoded format: field%253D%3Dvalue
          const encodedField = encodeURIComponent(encodeURIComponent(field));
          const encodedValue = encodeURIComponent(encodeURIComponent(filter.value));
          queryParts.push(`${encodedField}%253D%3D${encodedValue}`);
        } else {
          queryParts.push(`${encodeURIComponent(field)}${operator}${encodeURIComponent(filter.value)}`);
        }
      });

      // Build the URI in the format Plex expects
      const uri = `server://${machineId}/com.plexapp.plugins.library/library/sections/${library_id}/all?${queryParts.join('&')}`;

      // Debug logging
      console.log('DEBUG: Generated URI:', uri);
      console.log('DEBUG: Query parts:', queryParts);

      // Create smart playlist using POST to /playlists
      const createParams = new URLSearchParams();
      createParams.append('type', type);
      createParams.append('title', title);
      createParams.append('smart', '1');
      createParams.append('uri', uri);

      const response = await this.axios.post(`${plexUrl}/playlists?${createParams.toString()}`, null, {
        headers: {
          'X-Plex-Token': plexToken,
          Accept: 'application/json'
        },
        httpsAgent: this.getHttpsAgent()
      });

      const playlistData = response.data.MediaContainer.Metadata[0];

      return {
        content: [
          {
            type: 'text',
            text: `✅ **Smart Playlist Created Successfully**

**Playlist Details:**
• **Name:** ${playlistData.title}
• **Type:** ${playlistData.playlistType}
• **Tracks:** ${playlistData.leafCount || 0}
• **Duration:** ${playlistData.duration ? Math.round(playlistData.duration / 60000) + ' minutes' : 'Unknown'}
• **ID:** ${playlistData.ratingKey}

**Filters Applied:**
${filters.map(f => `• ${f.field} ${f.operator} "${f.value}"`).join('\n')}

The smart playlist has been created and is now available in your Plex library!`
          }
        ]
      };
    } catch (_error) {
      // Enhanced error handling for smart playlists
      let errorMessage = `Error creating smart playlist: ${_error.message}`;

      if (_error.response) {
        const status = _error.response.status;
        if (status === 400) {
          errorMessage = `❌ **Smart Playlist Creation Failed (400 Bad Request)**

**Possible issues:**
• Invalid filter criteria or field names
• Unsupported operator for the field type
• Library ID "${library_id}" not found or inaccessible
• Filter values in wrong format

**Debug info:**
• Status: ${status}
• Filters attempted: ${filters.length}
• Library ID: ${library_id}

**Suggestion:** Try with simpler filters first, or verify library_id with \`browse_libraries\`.`;
        } else if (status === 401 || status === 403) {
          errorMessage = 'Permission denied: Check your Plex token and server access';
        } else if (status >= 500) {
          errorMessage = `Plex server error (${status}): ${_error.message}`;
        }
      } else if (_error.code === 'ECONNREFUSED' || _error.code === 'ENOTFOUND') {
        errorMessage = 'Cannot connect to Plex server: Check PLEX_URL configuration';
      }

      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      };
    }
  }

  // Helper functions for smart playlist field/operator mapping
  mapFilterField(field) {
    // Return the field as-is since Plex expects the full dotted notation
    return field;
  }

  mapFilterOperator(operator) {
    const operatorMap = {
      is: '=',
      isnot: '!=',
      contains: '=', // Plex uses = for contains on text fields
      doesnotcontain: '!=',
      beginswith: '=', // Plex uses = for text matching
      endswith: '=',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<='
    };
    return operatorMap[operator] || operator;
  }

  mapSortField(sort) {
    const sortMap = {
      'artist.titleSort': 'artist',
      'album.titleSort': 'album',
      'track.titleSort': 'title',
      addedAt: 'addedAt',
      year: 'year',
      rating: 'userRating',
      lastViewedAt: 'lastViewedAt',
      random: 'random'
    };
    return sortMap[sort] || sort;
  }

  async handleAddToPlaylist(args) {
    const { playlist_id, item_keys } = args;

    // Input validation
    if (!playlist_id || typeof playlist_id !== 'string') {
      throw new Error('Valid playlist_id is required');
    }
    if (!item_keys || !Array.isArray(item_keys) || item_keys.length === 0) {
      throw new Error('item_keys must be a non-empty array');
    }
    if (item_keys.some(key => !key || typeof key !== 'string')) {
      throw new Error('All item_keys must be non-empty strings');
    }

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // Get playlist info before adding items
      const playlistInfoUrl = `${plexUrl}/playlists/${playlist_id}`;
      const playlistItemsUrl = `${plexUrl}/playlists/${playlist_id}/items`;

      // Get playlist metadata (title, etc.)
      const playlistInfoResponse = await this.axios.get(playlistInfoUrl, {
        params: {
          'X-Plex-Token': plexToken
        },
        httpsAgent: this.getHttpsAgent()
      });

      const playlistInfo = playlistInfoResponse.data.MediaContainer;
      const playlistTitle = playlistInfo.Metadata && playlistInfo.Metadata[0] ?
        playlistInfo.Metadata[0].title : `Playlist ${playlist_id}`;

      // Get current playlist items count
      let beforeCount = 0;
      try {
        const beforeResponse = await this.axios.get(playlistItemsUrl, {
          params: {
            'X-Plex-Token': plexToken
          },
          httpsAgent: this.getHttpsAgent()
        });
        const beforeItems = beforeResponse.data.MediaContainer?.Metadata || [];
        beforeCount = beforeItems.length; // Use actual count of items instead of totalSize
      } catch (_error) {
        // If items endpoint fails, playlist might be empty
        beforeCount = 0;
      }

      // Get server machine identifier for proper URI format
      const serverResponse = await this.axios.get(`${plexUrl}/`, {
        headers: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent()
      });

      const machineIdentifier = serverResponse.data?.MediaContainer?.machineIdentifier;
      if (!machineIdentifier) {
        throw new Error('Could not get server machine identifier');
      }

      const addUrl = `${plexUrl}/playlists/${playlist_id}/items`;

      // Try different batch approaches for multiple items
      let response;
      let batchMethod = '';

      if (item_keys.length === 1) {
        // Single item - use existing proven method
        const params = {
          'X-Plex-Token': plexToken,
          uri: `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${item_keys[0]}`
        };
        response = await this.axios.put(addUrl, null, { params, httpsAgent: this.getHttpsAgent() });
        batchMethod = 'single';
      } else {
        // Multiple items - use sequential individual adds (only reliable method)
        console.log(`Adding ${item_keys.length} items sequentially (batch operations are unreliable)...`);
        batchMethod = 'sequential-reliable';
        let sequentialCount = 0;
        const sequentialResults = [];

        for (const itemKey of item_keys) {
          try {
            const singleParams = {
              'X-Plex-Token': plexToken,
              uri: `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${itemKey}`
            };

            if (process.env.DEBUG_PLAYLISTS) {
              console.log(`Adding item ${itemKey} individually...`);
            }

            const singleResponse = await this.axios.put(addUrl, null, {
              params: singleParams,
              httpsAgent: this.getHttpsAgent(),
              timeout: 10000, // 10 second timeout
              validateStatus: function(status) {
                return status >= 200 && status < 300; // Only accept 2xx status codes
              }
            });

            if (singleResponse.status >= 200 && singleResponse.status < 300) {
              sequentialCount++;
              sequentialResults.push({ itemKey, success: true });
              if (process.env.DEBUG_PLAYLISTS) {
                console.log(`✅ Successfully added item ${itemKey}`);
              }
            } else {
              sequentialResults.push({ itemKey, success: false, status: singleResponse.status });
              console.warn(`❌ Failed to add item ${itemKey}, status: ${singleResponse.status}`);
            }

            // Small delay between sequential operations for API stability
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (seqError) {
            sequentialResults.push({ itemKey, success: false, error: seqError.message });
          }
        }

        // Create response for sequential operations
        response = {
          status: sequentialCount > 0 ? 200 : 400,
          data: {
            sequentialAdded: sequentialCount,
            sequentialResults: sequentialResults,
            totalRequested: item_keys.length
          }
        };

        if (process.env.DEBUG_PLAYLISTS) {
          console.log(`Sequential operation complete: ${sequentialCount}/${item_keys.length} items added successfully`);
        }
      }

      // Check if the PUT request was successful based on HTTP status
      const putSuccessful = response.status >= 200 && response.status < 300;

      // Verify the addition with retries due to Plex API reliability issues
      let afterCount = 0;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount <= maxRetries) {
        const delay = 300 * (retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, delay)); // Increasing delay

        try {
          // Try both the items endpoint and playlist metadata endpoint
          const [itemsResponse, playlistResponse] = await Promise.allSettled([
            this.axios.get(playlistItemsUrl, {
              params: { 'X-Plex-Token': plexToken },
              httpsAgent: this.getHttpsAgent()
            }),
            this.axios.get(playlistInfoUrl, {
              params: { 'X-Plex-Token': plexToken },
              httpsAgent: this.getHttpsAgent()
            })
          ]);

          // Try to get count from items endpoint first
          if (itemsResponse.status === 'fulfilled' && itemsResponse.value?.data) {
            try {
              const items = itemsResponse.value.data.MediaContainer?.Metadata || [];
              afterCount = items.length;
              break; // Success, exit retry loop
            } catch (parseError) {
              console.warn('Error parsing items response:', parseError.message);
            }
          }

          // Fall back to playlist metadata if items endpoint failed
          if (playlistResponse.status === 'fulfilled' && playlistResponse.value?.data) {
            try {
              const metadata = playlistResponse.value.data.MediaContainer?.Metadata?.[0];
              afterCount = parseInt(metadata?.leafCount || 0, 10) || 0;
              break; // Success, exit retry loop
            } catch (parseError) {
              console.warn('Error parsing playlist metadata:', parseError.message);
            }
          }
        } catch (_error) {
          retryCount++;
          if (retryCount > maxRetries) {
            // If all retries failed, fall back to optimistic counting
            afterCount = beforeCount + (putSuccessful ? item_keys.length : 0);
          }
        }
      }

      const actualAdded = afterCount - beforeCount;
      const attempted = item_keys.length;

      let resultText = `Playlist "${playlistTitle}" update:\n`;
      resultText += `• Attempted to add: ${attempted} item(s)\n`;
      resultText += `• Actually added: ${actualAdded} item(s)\n`;
      resultText += `• Playlist size: ${beforeCount} → ${afterCount} items\n`;

      // Show batch method for multiple items
      if (item_keys.length > 1) {
        const methodDescription = {
          'sequential-reliable': 'sequential individual adds (only reliable method for multiple items)'
        };
        resultText += `• Method used: ${methodDescription[batchMethod] || batchMethod}\n`;

        // Show success summary for sequential operations
        if (response.data?.sequentialAdded !== undefined) {
          const successRate = ((response.data.sequentialAdded / item_keys.length) * 100).toFixed(0);
          resultText += `• Success rate: ${response.data.sequentialAdded}/${item_keys.length} items (${successRate}%)\n`;
        }

        // Show individual results in debug mode
        if (response.data?.sequentialResults && process.env.DEBUG_PLAYLISTS) {
          resultText += '• Individual results:\n';
          response.data.sequentialResults.forEach(result => {
            const status = result.success ? '✅' : '❌';
            const detail = result.error ? ` (${result.error})` : result.status ? ` (HTTP ${result.status})` : '';
            resultText += `  ${status} ${result.itemKey}${detail}\n`;
          });
        }
      }

      // Debug information
      if (process.env.DEBUG_PLAYLISTS) {
        resultText += '\nDEBUG INFO:\n';
        resultText += `• Batch method used: ${batchMethod}\n`;
        resultText += `• PUT request status: ${response.status}\n`;
        resultText += `• PUT successful: ${putSuccessful}\n`;
        resultText += `• Before count: ${beforeCount}\n`;
        resultText += `• After count: ${afterCount}\n`;
        resultText += `• Retries needed: ${retryCount}\n`;
        resultText += `• Count verification method: ${retryCount > maxRetries ? 'fallback' : 'API'}\n`;
        resultText += `• Items requested: [${item_keys.join(', ')}]\n`;
        if (response.data?.sequentialAdded !== undefined) {
          resultText += `• Sequential adds successful: ${response.data.sequentialAdded}/${item_keys.length}\n`;
        }
      }

      // If HTTP request was successful but count didn't change,
      // it's likely the items already exist or are duplicates
      if (actualAdded === attempted) {
        resultText += '✅ All items added successfully!';
      } else if (actualAdded > 0) {
        resultText += `⚠️ Partial success: ${attempted - actualAdded} item(s) may have been duplicates or invalid`;
      } else if (putSuccessful) {
        resultText += '✅ API request successful! Items may already exist in playlist or were duplicates.\n';
        resultText += 'ℹ️ This is normal behavior - Plex doesn\'t add duplicate items.';
      } else {
        resultText += '❌ No items were added. This may indicate:\n';
        resultText += '  - Invalid item IDs (use ratingKey from search results)\n';
        resultText += '  - Items already exist in playlist\n';
        resultText += '  - Permission issues';
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      // Enhanced error handling with specific error types
      let errorMessage = `Error adding items to playlist: ${_error.message}`;

      if (_error.response) {
        const status = _error.response.status;
        if (status === 404) {
          errorMessage = `Playlist with ID ${playlist_id} not found`;
        } else if (status === 401 || status === 403) {
          errorMessage = 'Permission denied: Check your Plex token and server access';
        } else if (status >= 500) {
          errorMessage = `Plex server error (${status}): ${_error.message}`;
        }
      } else if (_error.code === 'ECONNREFUSED' || _error.code === 'ENOTFOUND') {
        errorMessage = 'Cannot connect to Plex server: Check PLEX_URL configuration';
      }

      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      };
    }
  }

  // DISABLED METHOD - PROBLEMATIC OPERATION
  // This method is currently disabled due to destructive Plex API behavior
  // It removes ALL instances of matching items, not just one instance
  // Use with extreme caution - consider implementing safer alternatives
  async handleRemoveFromPlaylist(args) {
    const { playlist_id, item_keys } = args;

    // Input validation
    if (!playlist_id || typeof playlist_id !== 'string') {
      throw new Error('Valid playlist_id is required');
    }
    if (!item_keys || !Array.isArray(item_keys) || item_keys.length === 0) {
      throw new Error('item_keys must be a non-empty array');
    }
    if (item_keys.some(key => !key || typeof key !== 'string')) {
      throw new Error('All item_keys must be non-empty strings');
    }

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // Get playlist info before removing items
      const playlistInfoUrl = `${plexUrl}/playlists/${playlist_id}`;
      const playlistItemsUrl = `${plexUrl}/playlists/${playlist_id}/items`;

      // Get playlist metadata (title, etc.)
      const playlistInfoResponse = await this.axios.get(playlistInfoUrl, {
        params: {
          'X-Plex-Token': plexToken
        },
        httpsAgent: this.getHttpsAgent()
      });

      const playlistInfo = playlistInfoResponse.data.MediaContainer;
      const playlistTitle = playlistInfo.Metadata && playlistInfo.Metadata[0] ?
        playlistInfo.Metadata[0].title : `Playlist ${playlist_id}`;

      // Get current playlist items with their detailed information
      let beforeCount = 0;
      let playlistItems = [];
      try {
        const beforeResponse = await this.axios.get(playlistItemsUrl, {
          params: {
            'X-Plex-Token': plexToken
          },
          httpsAgent: this.getHttpsAgent()
        });
        beforeCount = beforeResponse.data.MediaContainer?.totalSize || 0;
        playlistItems = beforeResponse.data.MediaContainer?.Metadata || [];
      } catch (_error) {
        // If items endpoint fails, playlist might be empty
        beforeCount = 0;
        playlistItems = [];
      }

      // Get server machine identifier for proper URI format
      const serverResponse = await this.axios.get(`${plexUrl}/`, {
        headers: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent()
      });

      const machineIdentifier = serverResponse.data?.MediaContainer?.machineIdentifier;
      if (!machineIdentifier) {
        throw new Error('Could not get server machine identifier');
      }

      // Find items to remove by matching ratingKeys to actual playlist positions
      const itemsToRemove = [];
      const itemKeysSet = new Set(item_keys);

      playlistItems.forEach((item, index) => {
        if (itemKeysSet.has(item.ratingKey)) {
          itemsToRemove.push({
            ratingKey: item.ratingKey,
            position: index,
            title: item.title || 'Unknown'
          });
        }
      });

      if (itemsToRemove.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No matching items found in playlist "${playlistTitle}".\\nSpecified items may not exist in this playlist.`
            }
          ]
        };
      }

      // WARNING: Current Plex API behavior - this removes ALL instances of matching items
      // This is a limitation of the Plex API - there's no way to remove just specific instances
      const removeUrl = `${plexUrl}/playlists/${playlist_id}/items`;
      const params = {
        'X-Plex-Token': plexToken,
        uri: itemsToRemove.map(item => `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${item.ratingKey}`).join(',')
      };

      const response = await this.axios.delete(removeUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      // Check if the DELETE request was successful based on HTTP status
      const deleteSuccessful = response.status >= 200 && response.status < 300;

      // Small delay to allow Plex server to update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify the removal by checking the playlist items again
      let afterCount = 0;
      try {
        const afterResponse = await this.axios.get(playlistItemsUrl, {
          params: {
            'X-Plex-Token': plexToken
          },
          httpsAgent: this.getHttpsAgent()
        });
        afterCount = afterResponse.data.MediaContainer?.totalSize || 0;
      } catch (_error) {
        // If items endpoint fails, playlist might be empty
        afterCount = 0;
      }

      const actualRemoved = beforeCount - afterCount;
      const attempted = item_keys.length;

      let resultText = `Playlist "${playlistTitle}" update:\n`;
      resultText += `• Attempted to remove: ${attempted} item(s)\n`;
      resultText += `• Found in playlist: ${itemsToRemove.length} item(s)\n`;
      resultText += `• Actually removed: ${actualRemoved} item(s)\n`;
      resultText += `• Playlist size: ${beforeCount} → ${afterCount} items\n\n`;

      // Add warning about Plex behavior
      if (itemsToRemove.length > 0) {
        resultText += '⚠️ **Important**: Plex removes ALL instances of matching items from playlists.\n';
        resultText += 'If you had duplicate tracks, all copies were removed.\n\n';
      }

      if (actualRemoved === attempted) {
        resultText += '✅ All items removed successfully!';
      } else if (actualRemoved > 0) {
        resultText += `⚠️ Partial success: ${attempted - actualRemoved} item(s) were not found in the playlist`;
      } else if (deleteSuccessful && itemsToRemove.length > 0) {
        resultText += '✅ API request successful! Items were processed.\n';
        resultText += 'ℹ️ If count didn\'t change, items may have already been removed previously.';
      } else if (deleteSuccessful) {
        resultText += '✅ API request successful! Items may not have been in the playlist.\n';
        resultText += 'ℹ️ This is normal behavior - Plex ignores requests to remove non-existent items.';
      } else {
        resultText += '❌ No items were removed. This may indicate:\n';
        resultText += '  - Invalid item IDs\n';
        resultText += '  - Items not present in playlist\n';
        resultText += '  - Permission issues';
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      // Enhanced error handling with specific error types
      let errorMessage = `Error removing items from playlist: ${_error.message}`;

      if (_error.response) {
        const status = _error.response.status;
        if (status === 404) {
          errorMessage = `Playlist with ID ${playlist_id} not found`;
        } else if (status === 401 || status === 403) {
          errorMessage = 'Permission denied: Check your Plex token and server access';
        } else if (status >= 500) {
          errorMessage = `Plex server error (${status}): ${_error.message}`;
        }
      } else if (_error.code === 'ECONNREFUSED' || _error.code === 'ENOTFOUND') {
        errorMessage = 'Cannot connect to Plex server: Check PLEX_URL configuration';
      }

      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      };
    }
  }

  async handleDeletePlaylist(args) {
    const { playlist_id } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const deleteUrl = `${plexUrl}/playlists/${playlist_id}`;
      const params = {
        'X-Plex-Token': plexToken
      };

      const _response = await this.axios.delete(deleteUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const resultText = `Successfully deleted playlist ${playlist_id}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deleting playlist: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handleWatchedStatus(args) {
    const { item_keys, account_id } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const statusResults = [];

      // Check each item individually to get detailed status
      for (const itemKey of item_keys) {
        try {
          const itemUrl = `${plexUrl}/library/metadata/${itemKey}`;
          const params = {
            'X-Plex-Token': plexToken
          };

          if (account_id) {
            params.accountID = account_id;
          }

          const response = await this.axios.get(itemUrl, {
            params,
            httpsAgent: this.getHttpsAgent()
          });

          const item = response.data?.MediaContainer?.Metadata?.[0];
          if (item) {
            statusResults.push(this.parseWatchedStatus(item));
          } else {
            statusResults.push({
              ratingKey: itemKey,
              title: 'Unknown',
              error: 'Item not found'
            });
          }
        } catch (_error) {
          statusResults.push({
            ratingKey: itemKey,
            title: 'Unknown',
            error: _error.message
          });
        }
      }

      let resultText = `Watch status for ${item_keys.length} item(s)`;
      if (account_id) { resultText += ` (account: ${account_id})`; }
      resultText += `:\n\n${this.formatWatchedStatus(statusResults)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking watch status: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseWatchedStatus(item) {
    return {
      ratingKey: item.ratingKey,
      title: item.title,
      type: item.type,
      year: item.year,
      viewCount: item.viewCount || 0,
      lastViewedAt: item.lastViewedAt,
      viewOffset: item.viewOffset || 0,
      duration: item.duration,
      watched: item.viewCount > 0,
      partiallyWatched: item.viewOffset > 0 && item.viewOffset < item.duration,
      grandparentTitle: item.grandparentTitle,
      parentTitle: item.parentTitle,
      index: item.index,
      parentIndex: item.parentIndex
    };
  }

  formatWatchedStatus(statusResults) {
    return statusResults.map((item, index) => {
      if (item.error) {
        return `${index + 1}. **${item.title}** (ID: ${item.ratingKey})\n   Error: ${item.error}`;
      }

      let formatted = `${index + 1}. **${item.title}**`;

      if (item.grandparentTitle) {
        formatted = `${index + 1}. **${item.grandparentTitle}**`;
        if (item.parentIndex) { formatted += ` S${item.parentIndex}`; }
        if (item.index) { formatted += `E${item.index}`; }
        formatted += ` - ${item.title}`;
      }

      if (item.year) {
        formatted += ` (${item.year})`;
      }

      // Watch status
      if (item.watched) {
        formatted += '\n   Status: ✅ Watched';
        if (item.viewCount > 1) {
          formatted += ` (${item.viewCount} times)`;
        }
      } else if (item.partiallyWatched) {
        const progress = Math.round((item.viewOffset / item.duration) * 100);
        const remainingMinutes = Math.round((item.duration - item.viewOffset) / 60000);
        formatted += `\n   Status: ⏸️ In Progress (${progress}% complete, ${remainingMinutes}m remaining)`;
      } else {
        formatted += '\n   Status: ⬜ Unwatched';
      }

      if (item.lastViewedAt) {
        const lastViewed = new Date(item.lastViewedAt * 1000);
        formatted += `\n   Last watched: ${lastViewed.toLocaleString()}`;
      }

      formatted += `\n   Item ID: ${item.ratingKey}`;

      return formatted;
    }).join('\n\n');
  }

  applyActivityFilters(results, filters) {
    const {
      play_count_min,
      play_count_max,
      last_played_after,
      last_played_before,
      played_in_last_days,
      never_played
    } = filters;

    return results.filter(item => {
      // Play count filters
      if (play_count_min !== undefined && (item.viewCount || 0) < play_count_min) {
        return false;
      }

      if (play_count_max !== undefined && (item.viewCount || 0) > play_count_max) {
        return false;
      }

      // Never played filter
      if (never_played && (item.viewCount || 0) > 0) {
        return false;
      }

      // Date-based filters
      if (item.lastViewedAt) {
        const lastViewedDate = new Date(item.lastViewedAt * 1000);

        if (last_played_after) {
          const afterDate = new Date(last_played_after);
          if (lastViewedDate < afterDate) {
            return false;
          }
        }

        if (last_played_before) {
          const beforeDate = new Date(last_played_before);
          if (lastViewedDate > beforeDate) {
            return false;
          }
        }

        if (played_in_last_days) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - played_in_last_days);
          if (lastViewedDate < cutoffDate) {
            return false;
          }
        }
      } else {
        // Item has never been played
        if (last_played_after || last_played_before || played_in_last_days) {
          return false; // Exclude unplayed items when filtering by play dates
        }
      }

      return true;
    });
  }

  applyAdvancedFilters(results, filters) {
    const {
      content_rating,
      resolution,
      audio_format,
      bpmMin: bpmMin,
      bpmMax: bpmMax,
      musical_key,
      dynamic_range_min,
      dynamic_range_max,
      loudness_min,
      loudness_max,
      mood,
      acoustic_ratio_min,
      acoustic_ratio_max,
      file_size_min,
      file_size_max
    } = filters;

    return results.filter(item => {
      // Content rating filter
      if (content_rating && item.contentRating !== content_rating) {
        return false;
      }

      // Resolution filter (requires Media array access)
      if (resolution) {
        // If resolution filter is applied but item has no Media, exclude it
        if (!item.Media || item.Media.length === 0) {
          return false;
        }

        const hasResolution = item.Media.some(media => {
          // Get height either from height property or derive from videoResolution
          let height = 0;

          if (media.height) {
            height = parseInt(media.height, 10) || 0;
          } else if (media.videoResolution) {
            // Convert videoResolution string to height for comparison
            switch (media.videoResolution) {
              case '4k':
                height = 2160;
                break;
              case '1080':
                height = 1080;
                break;
              case '720':
                height = 720;
                break;
              case '480':
              case 'sd':
                height = 480;
                break;
              default:
                height = 0;
            }
          }

          if (height === 0) { return false; }

          // Apply resolution filter based on height
          switch (resolution) {
            case '4k':
              return height >= 2160;
            case '1080':
              return height >= 1080;
            case '720':
              return height >= 720;
            case '480':
              return height >= 480;
            case 'sd':
              return height < 720;
            default:
              return false;
          }
        });

        if (!hasResolution) { return false; }
      }

      // Audio format filter (requires Media/Part array access)
      if (audio_format) {
        // If audio format filter is applied but item has no Media, exclude it
        if (!item.Media || item.Media.length === 0) {
          return false;
        }

        const hasAudioFormat = item.Media.some(media =>
          media.Part && media.Part.some(part => {
            if (!part.audioCodec) { return false; }

            switch (audio_format) {
              case 'lossless':
                return ['flac', 'alac', 'dts', 'truehd'].includes(part.audioCodec.toLowerCase());
              case 'lossy':
                return ['mp3', 'aac', 'ogg', 'ac3'].includes(part.audioCodec.toLowerCase());
              case 'mp3':
                return part.audioCodec.toLowerCase() === 'mp3';
              case 'flac':
                return part.audioCodec.toLowerCase() === 'flac';
              case 'aac':
                return part.audioCodec.toLowerCase() === 'aac';
              default:
                return false;
            }
          })
        );

        if (!hasAudioFormat) { return false; }
      }

      // File size filters (requires Media/Part array access)
      if (file_size_min !== undefined || file_size_max !== undefined) {
        // If file size filter is applied but item has no Media, exclude it
        if (!item.Media || item.Media.length === 0) {
          return false;
        }

        const totalSize = item.Media.reduce((total, media) => {
          if (media.Part) {
            return total + media.Part.reduce((partTotal, part) => {
              return partTotal + (part.size ? (parseInt(part.size, 10) || 0) / (1024 * 1024) : 0); // Convert to MB
            }, 0);
          }
          return total;
        }, 0);

        if (file_size_min !== undefined && totalSize < file_size_min) {
          return false;
        }

        if (file_size_max !== undefined && totalSize > file_size_max) {
          return false;
        }
      }

      // Audio analysis filters - using available data from item properties

      // BPM filters (using tempo property)
      if (bpmMin !== undefined || bpmMax !== undefined) {
        if (item.tempo) {
          if (bpmMin !== undefined && item.tempo < bpmMin) { return false; }
          if (bpmMax !== undefined && item.tempo > bpmMax) { return false; }
        }
      }

      // Musical key filter
      if (musical_key) {
        if (item.key && item.key.toLowerCase() !== musical_key.toLowerCase()) { return false; }
      }

      // Dynamic range filters
      if (dynamic_range_min !== undefined || dynamic_range_max !== undefined) {
        if (item.dynamicRange) {
          if (dynamic_range_min !== undefined && item.dynamicRange < dynamic_range_min) { return false; }
          if (dynamic_range_max !== undefined && item.dynamicRange > dynamic_range_max) { return false; }
        }
      }

      // Loudness filters (LUFS)
      if (loudness_min !== undefined || loudness_max !== undefined) {
        if (item.loudness) {
          if (loudness_min !== undefined && item.loudness < loudness_min) { return false; }
          if (loudness_max !== undefined && item.loudness > loudness_max) { return false; }
        }
      }

      // Mood filter
      if (mood) {
        if (item.mood && item.mood.toLowerCase() !== mood.toLowerCase()) { return false; }
      }

      // Acoustic ratio filters
      if (acoustic_ratio_min !== undefined || acoustic_ratio_max !== undefined) {
        if (item.acousticRatio !== undefined) {
          if (acoustic_ratio_min !== undefined && item.acousticRatio < acoustic_ratio_min) { return false; }
          if (acoustic_ratio_max !== undefined && item.acousticRatio > acoustic_ratio_max) { return false; }
        }
      }

      return true;
    });
  }

  applyBasicFilters(results, filters) {
    const {
      genre,
      year,
      year_min,
      year_max,
      studio,
      director,
      writer,
      actor,
      rating_min,
      rating_max,
      duration_min,
      duration_max,
      added_after,
      added_before
    } = filters;

    return results.filter(item => {
      // Genre filter
      if (genre && item.genres) {
        const hasGenre = item.genres.some(g =>
          g.toLowerCase().includes(genre.toLowerCase())
        );
        if (!hasGenre) { return false; }
      }

      // Year filters
      if (year && item.year !== year) {
        return false;
      }

      if (year_min && (!item.year || item.year < year_min)) {
        return false;
      }

      if (year_max && (!item.year || item.year > year_max)) {
        return false;
      }

      // Studio filter
      if (studio && item.studio) {
        if (!item.studio.toLowerCase().includes(studio.toLowerCase())) {
          return false;
        }
      }

      // Director filter (requires detailed metadata)
      if (director && item.directors) {
        const hasDirector = item.directors.some(d =>
          d.toLowerCase().includes(director.toLowerCase())
        );
        if (!hasDirector) { return false; }
      }

      // Writer filter (requires detailed metadata)
      if (writer && item.writers) {
        const hasWriter = item.writers.some(w =>
          w.toLowerCase().includes(writer.toLowerCase())
        );
        if (!hasWriter) { return false; }
      }

      // Actor filter (requires detailed metadata)
      if (actor && item.actors) {
        const hasActor = item.actors.some(a =>
          a.toLowerCase().includes(actor.toLowerCase())
        );
        if (!hasActor) { return false; }
      }

      // Rating filters
      if (rating_min !== undefined && (!item.rating || item.rating < rating_min)) {
        return false;
      }

      if (rating_max !== undefined && (!item.rating || item.rating > rating_max)) {
        return false;
      }

      // Duration filters (convert to minutes)
      if (duration_min !== undefined && item.duration) {
        const durationMinutes = Math.floor(item.duration / 60000);
        if (durationMinutes < duration_min) {
          return false;
        }
      }

      if (duration_max !== undefined && item.duration) {
        const durationMinutes = Math.floor(item.duration / 60000);
        if (durationMinutes > duration_max) {
          return false;
        }
      }

      // Added date filters
      if (item.addedAt) {
        const addedDate = new Date(item.addedAt * 1000);

        if (added_after) {
          const afterDate = new Date(added_after);
          if (addedDate < afterDate) {
            return false;
          }
        }

        if (added_before) {
          const beforeDate = new Date(added_before);
          if (addedDate > beforeDate) {
            return false;
          }
        }
      }

      return true;
    });
  }

  async handleGetCollections(args) {
    const { library_id } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      let collectionsUrl;
      if (library_id) {
        collectionsUrl = `${plexUrl}/library/sections/${library_id}/collections`;
      } else {
        collectionsUrl = `${plexUrl}/library/collections`;
      }

      const params = {
        'X-Plex-Token': plexToken
      };

      const response = await this.axios.get(collectionsUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const collections = this.parseCollections(response.data);

      let resultText = 'Collections';
      if (library_id) { resultText += ` from library ${library_id}`; }
      resultText += ` - ${collections.length} found:\n\n${this.formatCollections(collections)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting collections: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handleBrowseCollection(args) {
    const { collection_id, sort = 'titleSort', limit = 20, offset = 0 } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const collectionUrl = `${plexUrl}/library/collections/${collection_id}/children`;
      const params = {
        'X-Plex-Token': plexToken,
        sort: sort,
        'X-Plex-Container-Start': offset,
        'X-Plex-Container-Size': limit
      };

      const response = await this.axios.get(collectionUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const results = this.parseLibraryContent(response.data);
      const totalSize = response.data.MediaContainer?.totalSize || results.length;

      let resultText = `Collection content (${offset + 1}-${Math.min(offset + limit, totalSize)} of ${totalSize})`;
      if (sort !== 'titleSort') { resultText += ` | Sorted by: ${sort}`; }
      resultText += `:\n\n${this.formatResults(results)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error browsing collection: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseCollections(data) {
    if (!data.MediaContainer || !data.MediaContainer.Metadata) {
      return [];
    }

    return data.MediaContainer.Metadata.map(collection => ({
      ratingKey: collection.ratingKey,
      key: collection.key,
      title: collection.title,
      type: collection.type,
      subtype: collection.subtype,
      summary: collection.summary,
      childCount: collection.childCount,
      addedAt: collection.addedAt,
      updatedAt: collection.updatedAt,
      thumb: collection.thumb,
      smart: collection.smart
    }));
  }

  formatCollections(collections) {
    return collections.map((collection, index) => {
      let formatted = `${index + 1}. **${collection.title}**`;

      if (collection.subtype) {
        formatted += ` (${collection.subtype})`;
      }

      if (collection.smart) {
        formatted += ' - Smart Collection';
      }

      if (collection.childCount) {
        formatted += `\n   Items: ${collection.childCount}`;
      }

      if (collection.summary) {
        formatted += `\n   ${collection.summary.substring(0, 120)}${collection.summary.length > 120 ? '...' : ''}`;
      }

      if (collection.addedAt) {
        const addedDate = new Date(collection.addedAt * 1000).toLocaleDateString();
        formatted += `\n   Created: ${addedDate}`;
      }

      formatted += `\n   Collection ID: ${collection.ratingKey}`;

      return formatted;
    }).join('\n\n');
  }

  async handleGetMediaInfo(args) {
    const { item_key } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      const mediaUrl = `${plexUrl}/library/metadata/${item_key}`;
      const params = {
        'X-Plex-Token': plexToken
      };

      const response = await this.axios.get(mediaUrl, {
        params,
        httpsAgent: this.getHttpsAgent()
      });

      const item = response.data?.MediaContainer?.Metadata?.[0];
      if (!item) {
        throw new Error('Item not found');
      }

      const mediaInfo = this.parseMediaInfo(item);

      const resultText = `Media Information for "${item.title}":\\n\\n${this.formatMediaInfo(mediaInfo)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting media info: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  parseMediaInfo(item) {
    const mediaInfo = {
      title: item.title,
      type: item.type,
      year: item.year,
      duration: item.duration,
      addedAt: item.addedAt,
      updatedAt: item.updatedAt,
      contentRating: item.contentRating,
      studio: item.studio,
      originallyAvailableAt: item.originallyAvailableAt,
      media: []
    };

    if (item.Media && item.Media.length > 0) {
      mediaInfo.media = item.Media.map(media => ({
        id: media.id,
        duration: media.duration,
        bitrate: media.bitrate,
        width: media.width,
        height: media.height,
        aspectRatio: media.aspectRatio,
        audioChannels: media.audioChannels,
        audioCodec: media.audioCodec,
        videoCodec: media.videoCodec,
        videoResolution: media.videoResolution,
        container: media.container,
        videoFrameRate: media.videoFrameRate,
        audioProfile: media.audioProfile,
        videoProfile: media.videoProfile,
        // Top-level audio analysis metadata that might be available
        tempo: item.tempo || item.bpm,
        key: item.key || item.musicalKey,
        dynamicRange: item.dynamicRange,
        loudness: item.loudness || item.lufs,
        mood: item.mood || item.energy,
        acousticRatio: item.acousticRatio || item.instrumentalness,
        audioQuality: this.calculateAudioQuality(media),
        parts: media.Part ? media.Part.map(part => ({
          id: part.id,
          key: part.key,
          duration: part.duration,
          file: part.file,
          size: part.size,
          audioProfile: part.audioProfile,
          container: part.container,
          videoProfile: part.videoProfile,
          streams: part.Stream ? part.Stream.map(stream => ({
            id: stream.id,
            streamType: stream.streamType,
            default: stream.default,
            codec: stream.codec,
            index: stream.index,
            bitrate: stream.bitrate,
            language: stream.language,
            languageCode: stream.languageCode,
            bitDepth: stream.bitDepth,
            chromaLocation: stream.chromaLocation,
            chromaSubsampling: stream.chromaSubsampling,
            codedHeight: stream.codedHeight,
            codedWidth: stream.codedWidth,
            colorRange: stream.colorRange,
            frameRate: stream.frameRate,
            height: stream.height,
            width: stream.width,
            displayTitle: stream.displayTitle,
            extendedDisplayTitle: stream.extendedDisplayTitle,
            channels: stream.channels,
            audioChannelLayout: stream.audioChannelLayout,
            samplingRate: stream.samplingRate,
            profile: stream.profile,
            refFrames: stream.refFrames,
            scanType: stream.scanType,
            title: stream.title,
            // Audio analysis fields - these may be available in Plex metadata
            tempo: stream.tempo || stream.bpm,
            key: stream.key || stream.musicalKey,
            dynamicRange: stream.dynamicRange,
            loudness: stream.loudness || stream.lufs,
            mood: stream.mood || stream.energy,
            acousticRatio: stream.acousticRatio || stream.instrumentalness
          })) : []
        })) : []
      }));
    }

    return mediaInfo;
  }

  formatMediaInfo(mediaInfo) {
    let formatted = `**${mediaInfo.title}**`;

    if (mediaInfo.year) {
      formatted += ` (${mediaInfo.year})`;
    }

    if (mediaInfo.type) {
      formatted += ` - ${mediaInfo.type}`;
    }

    if (mediaInfo.duration) {
      const hours = Math.floor(mediaInfo.duration / 3600000);
      const minutes = Math.floor((mediaInfo.duration % 3600000) / 60000);
      if (hours > 0) {
        formatted += `\\n   Duration: ${hours}h ${minutes}m`;
      } else {
        formatted += `\\n   Duration: ${minutes}m`;
      }
    }

    if (mediaInfo.contentRating) {
      formatted += ` | Rating: ${mediaInfo.contentRating}`;
    }

    if (mediaInfo.studio) {
      formatted += `\\n   Studio: ${mediaInfo.studio}`;
    }

    if (mediaInfo.originallyAvailableAt) {
      const releaseDate = new Date(mediaInfo.originallyAvailableAt).toLocaleDateString();
      formatted += `\\n   Released: ${releaseDate}`;
    }

    if (mediaInfo.addedAt) {
      const addedDate = new Date(mediaInfo.addedAt * 1000).toLocaleDateString();
      formatted += `\\n   Added to library: ${addedDate}`;
    }

    // Format media files information
    if (mediaInfo.media && mediaInfo.media.length > 0) {
      formatted += `\\n\\n**Media Files (${mediaInfo.media.length} version${mediaInfo.media.length > 1 ? 's' : ''}):**`;

      mediaInfo.media.forEach((media, index) => {
        formatted += `\\n\\n**Version ${index + 1}:**`;

        if (media.container) {
          formatted += `\\n   Container: ${media.container.toUpperCase()}`;
        }

        if (media.bitrate) {
          formatted += ` | Bitrate: ${media.bitrate} kbps`;
        }

        if (media.width && media.height) {
          formatted += `\\n   Resolution: ${media.width}×${media.height}`;
          if (media.videoResolution) {
            formatted += ` (${media.videoResolution})`;
          }
        }

        if (media.aspectRatio) {
          formatted += ` | Aspect Ratio: ${media.aspectRatio}`;
        }

        if (media.videoCodec) {
          formatted += `\\n   Video Codec: ${media.videoCodec.toUpperCase()}`;
        }

        if (media.videoFrameRate) {
          formatted += ` | Frame Rate: ${media.videoFrameRate} fps`;
        }

        if (media.videoProfile) {
          formatted += ` | Profile: ${media.videoProfile}`;
        }

        if (media.audioCodec) {
          formatted += `\\n   Audio Codec: ${media.audioCodec.toUpperCase()}`;
        }

        if (media.audioChannels) {
          formatted += ` | Channels: ${media.audioChannels}`;
        }

        if (media.audioProfile) {
          formatted += ` | Profile: ${media.audioProfile}`;
        }

        // Format file parts
        if (media.parts && media.parts.length > 0) {
          formatted += '\\n\\n   **Files:**';

          media.parts.forEach((part, partIndex) => {
            formatted += `\\n\\n   **File ${partIndex + 1}:**`;

            if (part.file) {
              const fileName = part.file.split('/').pop();
              formatted += `\\n     Filename: ${fileName}`;
            }

            if (part.size) {
              const sizeMB = Math.round((parseInt(part.size, 10) || 0) / (1024 * 1024));
              const sizeGB = (sizeMB / 1024).toFixed(2);
              if (sizeMB > 1024) {
                formatted += `\\n     File Size: ${sizeGB} GB`;
              } else {
                formatted += `\\n     File Size: ${sizeMB} MB`;
              }
            }

            if (part.duration) {
              const hours = Math.floor(part.duration / 3600000);
              const minutes = Math.floor((part.duration % 3600000) / 60000);
              if (hours > 0) {
                formatted += `\\n     Duration: ${hours}h ${minutes}m`;
              } else {
                formatted += `\\n     Duration: ${minutes}m`;
              }
            }

            // Format streams
            if (part.streams && part.streams.length > 0) {
              const videoStreams = part.streams.filter(s => s.streamType === 1);
              const audioStreams = part.streams.filter(s => s.streamType === 2);
              const subtitleStreams = part.streams.filter(s => s.streamType === 3);

              if (videoStreams.length > 0) {
                formatted += `\\n\\n     **Video Streams (${videoStreams.length}):**`;
                videoStreams.forEach((stream, streamIndex) => {
                  formatted += `\\n       ${streamIndex + 1}. ${stream.displayTitle || stream.codec?.toUpperCase() || 'Unknown'}`;
                  if (stream.bitrate) { formatted += ` | ${stream.bitrate} kbps`; }
                  if (stream.width && stream.height) { formatted += ` | ${stream.width}×${stream.height}`; }
                  if (stream.frameRate) { formatted += ` | ${stream.frameRate} fps`; }
                  if (stream.profile) { formatted += ` | ${stream.profile}`; }
                });
              }

              if (audioStreams.length > 0) {
                formatted += `\\n\\n     **Audio Streams (${audioStreams.length}):**`;
                audioStreams.forEach((stream, streamIndex) => {
                  formatted += `\\n       ${streamIndex + 1}. ${stream.displayTitle || stream.codec?.toUpperCase() || 'Unknown'}`;
                  if (stream.language) { formatted += ` | ${stream.language}`; }
                  if (stream.channels) { formatted += ` | ${stream.channels} ch`; }
                  if (stream.bitrate) { formatted += ` | ${stream.bitrate} kbps`; }
                  if (stream.samplingRate) { formatted += ` | ${stream.samplingRate} Hz`; }
                  if (stream.audioChannelLayout) { formatted += ` | ${stream.audioChannelLayout}`; }
                  if (stream.default) { formatted += ' | Default'; }
                });
              }

              if (subtitleStreams.length > 0) {
                formatted += `\\n\\n     **Subtitle Streams (${subtitleStreams.length}):**`;
                subtitleStreams.forEach((stream, streamIndex) => {
                  formatted += `\\n       ${streamIndex + 1}. ${stream.displayTitle || stream.language || 'Unknown'}`;
                  if (stream.codec) { formatted += ` | ${stream.codec.toUpperCase()}`; }
                  if (stream.default) { formatted += ' | Default'; }
                });
              }
            }
          });
        }
      });
    }

    return formatted;
  }

  async handleGetLibraryStats(args) {
    const { library_id, include_details = false } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // Get library information first
      const librariesResponse = await this.axios.get(`${plexUrl}/library/sections`, {
        params: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent()
      });

      const libraries = this.parseLibraries(librariesResponse.data);
      let targetLibraries = libraries;

      if (library_id) {
        targetLibraries = libraries.filter(lib => lib.key === library_id);
        if (targetLibraries.length === 0) {
          throw new Error(`Library with ID ${library_id} not found`);
        }
      }

      const stats = await this.calculateLibraryStats(targetLibraries, include_details, plexUrl, plexToken);

      let resultText = library_id ?
        `Library Statistics for "${targetLibraries[0].title}":` :
        `Plex Server Statistics (${targetLibraries.length} libraries):`;

      resultText += `\\n\\n${this.formatLibraryStats(stats, include_details)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting library statistics: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async calculateLibraryStats(libraries, includeDetails, plexUrl, plexToken) {
    const stats = {
      totalLibraries: libraries.length,
      totalItems: 0,
      totalSize: 0,
      totalDuration: 0,
      libraries: [],
      overview: {
        contentTypes: {},
        fileFormats: {},
        resolutions: {},
        audioCodecs: {},
        videoCodecs: {}
      }
    };

    for (const library of libraries) {
      const libraryStats = {
        name: library.title,
        type: library.type,
        key: library.key,
        itemCount: 0,
        totalSize: 0,
        totalDuration: 0,
        contentBreakdown: {},
        details: includeDetails ? {
          fileFormats: {},
          resolutions: {},
          audioCodecs: {},
          videoCodecs: {},
          contentRatings: {},
          decades: {}
        } : null
      };

      // Get all content from this library with media information
      let offset = 0;
      const batchSize = 100;
      let hasMore = true;

      while (hasMore) {
        const contentResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
          params: {
            'X-Plex-Token': plexToken,
            'X-Plex-Container-Start': offset,
            'X-Plex-Container-Size': batchSize
          },
          httpsAgent: this.getHttpsAgent()
        });

        const content = this.parseLibraryContent(contentResponse.data);

        if (content.length === 0) {
          hasMore = false;
          break;
        }

        // Process each item
        for (const item of content) {
          libraryStats.itemCount++;

          // Count by content type
          const contentType = item.type || 'unknown';
          libraryStats.contentBreakdown[contentType] = (libraryStats.contentBreakdown[contentType] || 0) + 1;
          stats.overview.contentTypes[contentType] = (stats.overview.contentTypes[contentType] || 0) + 1;

          if (item.duration) {
            libraryStats.totalDuration += item.duration;
          }

          if (includeDetails) {
            // Add decade information
            if (item.year) {
              const decade = Math.floor(item.year / 10) * 10;
              libraryStats.details.decades[`${decade}s`] = (libraryStats.details.decades[`${decade}s`] || 0) + 1;
            }

            // Add content rating
            if (item.contentRating) {
              libraryStats.details.contentRatings[item.contentRating] = (libraryStats.details.contentRatings[item.contentRating] || 0) + 1;
            }
          }

          // Get detailed media information if available
          if (item.key) {
            try {
              const mediaResponse = await this.axios.get(`${plexUrl}${item.key}`, {
                params: { 'X-Plex-Token': plexToken },
                httpsAgent: this.getHttpsAgent()
              });

              const detailedItem = mediaResponse.data?.MediaContainer?.Metadata?.[0];
              if (detailedItem && detailedItem.Media) {
                for (const media of detailedItem.Media) {
                  // Calculate file sizes
                  if (media.Part) {
                    for (const part of media.Part) {
                      if (part.size) {
                        const sizeBytes = parseInt(part.size, 10) || 0;
                        libraryStats.totalSize += sizeBytes;

                        if (includeDetails) {
                          // Track file formats
                          if (media.container) {
                            libraryStats.details.fileFormats[media.container.toUpperCase()] =
                              (libraryStats.details.fileFormats[media.container.toUpperCase()] || 0) + 1;
                            stats.overview.fileFormats[media.container.toUpperCase()] =
                              (stats.overview.fileFormats[media.container.toUpperCase()] || 0) + 1;
                          }
                        }
                      }
                    }
                  }

                  if (includeDetails) {
                    // Track resolutions
                    if (media.width && media.height) {
                      const resolution = `${media.width}×${media.height}`;
                      libraryStats.details.resolutions[resolution] = (libraryStats.details.resolutions[resolution] || 0) + 1;
                      stats.overview.resolutions[resolution] = (stats.overview.resolutions[resolution] || 0) + 1;
                    } else if (media.videoResolution) {
                      libraryStats.details.resolutions[media.videoResolution] = (libraryStats.details.resolutions[media.videoResolution] || 0) + 1;
                      stats.overview.resolutions[media.videoResolution] = (stats.overview.resolutions[media.videoResolution] || 0) + 1;
                    }

                    // Track codecs
                    if (media.videoCodec) {
                      libraryStats.details.videoCodecs[media.videoCodec.toUpperCase()] =
                        (libraryStats.details.videoCodecs[media.videoCodec.toUpperCase()] || 0) + 1;
                      stats.overview.videoCodecs[media.videoCodec.toUpperCase()] =
                        (stats.overview.videoCodecs[media.videoCodec.toUpperCase()] || 0) + 1;
                    }

                    if (media.audioCodec) {
                      libraryStats.details.audioCodecs[media.audioCodec.toUpperCase()] =
                        (libraryStats.details.audioCodecs[media.audioCodec.toUpperCase()] || 0) + 1;
                      stats.overview.audioCodecs[media.audioCodec.toUpperCase()] =
                        (stats.overview.audioCodecs[media.audioCodec.toUpperCase()] || 0) + 1;
                    }
                  }
                }
              }
            } catch (_error) {
              // Skip detailed media info if not available
              console.error(`Could not get media details for item ${item.key}: ${_error.message}`);
            }
          }
        }

        offset += batchSize;
        if (content.length < batchSize) {
          hasMore = false;
        }
      }

      stats.totalItems += libraryStats.itemCount;
      stats.totalSize += libraryStats.totalSize;
      stats.totalDuration += libraryStats.totalDuration;
      stats.libraries.push(libraryStats);
    }

    return stats;
  }

  formatLibraryStats(stats, includeDetails) {
    let formatted = '**Overview:**\\n';
    formatted += `   Total Libraries: ${stats.totalLibraries}\\n`;
    formatted += `   Total Items: ${stats.totalItems.toLocaleString()}\\n`;

    if (stats.totalSize > 0) {
      const sizeGB = (stats.totalSize / (1024 * 1024 * 1024)).toFixed(2);
      const sizeTB = (stats.totalSize / (1024 * 1024 * 1024 * 1024)).toFixed(2);
      if (parseFloat(sizeTB) >= 1) {
        formatted += `   Total Storage: ${sizeTB} TB\\n`;
      } else {
        formatted += `   Total Storage: ${sizeGB} GB\\n`;
      }
    }

    if (stats.totalDuration > 0) {
      const totalHours = Math.floor(stats.totalDuration / 3600000);
      const totalDays = Math.floor(totalHours / 24);
      if (totalDays > 1) {
        formatted += `   Total Duration: ${totalDays} days (${totalHours.toLocaleString()} hours)\\n`;
      } else {
        formatted += `   Total Duration: ${totalHours.toLocaleString()} hours\\n`;
      }
    }

    // Content type breakdown
    if (Object.keys(stats.overview.contentTypes).length > 0) {
      formatted += '\\n**Content Types:**\\n';
      const sortedTypes = Object.entries(stats.overview.contentTypes)
        .sort(([, a], [, b]) => b - a);
      for (const [type, count] of sortedTypes) {
        formatted += `   ${type}: ${count.toLocaleString()} items\\n`;
      }
    }

    // Library breakdown
    if (stats.libraries.length > 1) {
      formatted += '\\n**Libraries:**\\n';
      for (const library of stats.libraries) {
        formatted += `\\n**${library.name}** (${library.type})\\n`;
        formatted += `   Items: ${library.itemCount.toLocaleString()}\\n`;

        if (library.totalSize > 0) {
          const sizeGB = (library.totalSize / (1024 * 1024 * 1024)).toFixed(2);
          formatted += `   Storage: ${sizeGB} GB\\n`;
        }

        if (library.totalDuration > 0) {
          const hours = Math.floor(library.totalDuration / 3600000);
          formatted += `   Duration: ${hours.toLocaleString()} hours\\n`;
        }

        // Content breakdown for this library
        if (Object.keys(library.contentBreakdown).length > 0) {
          const sortedContent = Object.entries(library.contentBreakdown)
            .sort(([, a], [, b]) => b - a);
          formatted += '   Content: ';
          formatted += sortedContent.map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`).join(', ');
          formatted += '\\n';
        }
      }
    }

    // Detailed breakdowns
    if (includeDetails) {
      if (Object.keys(stats.overview.fileFormats).length > 0) {
        formatted += '\\n**File Formats:**\\n';
        const sortedFormats = Object.entries(stats.overview.fileFormats)
          .sort(([, a], [, b]) => b - a);
        for (const [format, count] of sortedFormats) {
          formatted += `   ${format}: ${count.toLocaleString()} files\\n`;
        }
      }

      if (Object.keys(stats.overview.resolutions).length > 0) {
        formatted += '\\n**Resolutions:**\\n';
        const sortedResolutions = Object.entries(stats.overview.resolutions)
          .sort(([, a], [, b]) => b - a);
        for (const [resolution, count] of sortedResolutions) {
          formatted += `   ${resolution}: ${count.toLocaleString()} items\\n`;
        }
      }

      if (Object.keys(stats.overview.videoCodecs).length > 0) {
        formatted += '\\n**Video Codecs:**\\n';
        const sortedCodecs = Object.entries(stats.overview.videoCodecs)
          .sort(([, a], [, b]) => b - a);
        for (const [codec, count] of sortedCodecs) {
          formatted += `   ${codec}: ${count.toLocaleString()} items\\n`;
        }
      }

      if (Object.keys(stats.overview.audioCodecs).length > 0) {
        formatted += '\\n**Audio Codecs:**\\n';
        const sortedCodecs = Object.entries(stats.overview.audioCodecs)
          .sort(([, a], [, b]) => b - a);
        for (const [codec, count] of sortedCodecs) {
          formatted += `   ${codec}: ${count.toLocaleString()} items\\n`;
        }
      }

      // Per-library details if multiple libraries
      if (stats.libraries.length > 1) {
        for (const library of stats.libraries) {
          if (library.details) {
            formatted += `\\n**${library.name} - Detailed Breakdown:**\\n`;

            if (Object.keys(library.details.decades).length > 0) {
              formatted += '   Decades: ';
              const sortedDecades = Object.entries(library.details.decades)
                .sort(([a], [b]) => a.localeCompare(b));
              formatted += sortedDecades.map(([decade, count]) => `${decade} (${count})`).join(', ');
              formatted += '\\n';
            }

            if (Object.keys(library.details.contentRatings).length > 0) {
              formatted += '   Ratings: ';
              const sortedRatings = Object.entries(library.details.contentRatings)
                .sort(([, a], [, b]) => b - a);
              formatted += sortedRatings.map(([rating, count]) => `${rating} (${count})`).join(', ');
              formatted += '\\n';
            }
          }
        }
      }
    }

    return formatted;
  }

  async handleGetListeningStats(args) {
    const {
      account_id,
      time_period = 'month',
      include_recommendations = true,
      music_library_id
    } = args;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // Auto-detect music libraries if not specified
      let musicLibraries = [];
      if (music_library_id) {
        musicLibraries = [{ key: music_library_id, title: 'Music Library' }];
      } else {
        const librariesResponse = await this.axios.get(`${plexUrl}/library/sections`, {
          params: { 'X-Plex-Token': plexToken },
          httpsAgent: this.getHttpsAgent()
        });

        const allLibraries = this.parseLibraries(librariesResponse.data);
        musicLibraries = allLibraries.filter(lib => lib.type === 'artist');

        if (musicLibraries.length === 0) {
          throw new Error('No music libraries found. Please specify a music_library_id.');
        }
      }

      const stats = await this.calculateListeningStats(
        musicLibraries,
        account_id,
        time_period,
        include_recommendations,
        plexUrl,
        plexToken
      );

      let resultText = account_id ?
        `Listening Statistics for User ${account_id} (${time_period}):` :
        `Music Listening Statistics (${time_period}):`;

      resultText += `\\n\\n${this.formatListeningStats(stats, include_recommendations)}`;

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting listening statistics: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async handleDiscoverMusic(args) {
    const { query, context, limit = 10 } = args;

    // Apply randomization settings for music discovery
    const enhancedArgs = this.applyRandomizationSettings(query, 'track', args);
    const finalLimit = enhancedArgs.limit || limit;

    try {
      const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';
      const plexToken = await this.authManager.getAuthToken();

      // Get music libraries
      const librariesResponse = await this.axios.get(`${plexUrl}/library/sections`, {
        params: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent()
      });

      const allLibraries = this.parseLibraries(librariesResponse.data);
      const musicLibraries = allLibraries.filter(lib => lib.type === 'artist');

      if (musicLibraries.length === 0) {
        throw new Error('No music libraries found.');
      }

      // Get user's listening stats for context
      const stats = await this.calculateListeningStats(
        musicLibraries,
        null,
        'month',
        false, // Don't need recommendations for this
        plexUrl,
        plexToken
      );

      // Parse the natural language query
      const discovery = await this.processNaturalLanguageQuery(
        query,
        context,
        stats,
        musicLibraries,
        plexUrl,
        plexToken,
        finalLimit
      );

      // Apply additional randomization if needed and we have more results than requested
      const shouldRandomize = this.detectRandomizationIntent(query);
      if (shouldRandomize && discovery.results.length > limit) {
        discovery.results = this.applyClientSideRandomization(discovery.results, limit);
      }

      let resultText = '🎵 **Music Discovery Results**\\n\\n';
      resultText += `Query: "${query}"\\n\\n`;

      if (discovery.analysis) {
        resultText += `**What I found:** ${discovery.analysis}\\n\\n`;
      }

      if (discovery.results.length > 0) {
        resultText += '**Recommendations:**\\n';
        discovery.results.forEach((item, index) => {
          resultText += `${index + 1}. **${item.title}** by ${item.artist}\\n`;
          if (item.album) { resultText += `   Album: ${item.album}\\n`; }
          if (item.reason) { resultText += `   ${item.reason}\\n`; }
          resultText += '\\n';
        });
      } else {
        resultText += 'No results found that match your query. Your library might not have what you\'re looking for, or try a different search.\\n';
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };
    } catch (_error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error with music discovery: ${_error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async calculateListeningStats(musicLibraries, accountId, timePeriod, includeRecommendations, plexUrl, plexToken) {
    const stats = {
      timePeriod,
      totalPlays: 0,
      totalListeningTime: 0,
      uniqueTracks: new Set(),
      uniqueArtists: new Set(),
      uniqueAlbums: new Set(),
      topTracks: {},
      topArtists: {},
      topAlbums: {},
      topGenres: {},
      listeningPatterns: {
        byHour: Array(24).fill(0),
        byDayOfWeek: Array(7).fill(0),
        byMonth: Array(12).fill(0)
      },
      recentDiscoveries: [],
      recommendations: []
    };

    // Calculate time cutoff based on period
    const now = new Date();
    let cutoffDate = new Date(0); // Default to beginning of time

    switch (timePeriod) {
      case 'week':
        cutoffDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'month':
        cutoffDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'quarter':
        cutoffDate = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
        break;
      case 'year':
        cutoffDate = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000));
        break;
      case 'all':
        cutoffDate = new Date(0);
        break;
    }

    // Get listening history from Plex
    const historyParams = {
      'X-Plex-Token': plexToken,
      'X-Plex-Container-Size': 1000 // Get a large batch of history
    };

    if (accountId) {
      historyParams.accountID = accountId;
    }

    try {
      const historyResponse = await this.axios.get(`${plexUrl}/status/sessions/history/all`, {
        params: historyParams,
        httpsAgent: this.getHttpsAgent()
      });

      const history = this.parseWatchHistory(historyResponse.data);

      // Filter for music content and time period
      const musicHistory = history.filter(item => {
        const isMusic = item.type === 'track';
        const viewedDate = new Date(item.viewedAt * 1000);
        const inTimePeriod = viewedDate >= cutoffDate;
        return isMusic && inTimePeriod;
      });

      // Process each music play
      for (const play of musicHistory) {
        stats.totalPlays++;

        if (play.duration) {
          stats.totalListeningTime += play.duration;
        }

        // Track unique content
        stats.uniqueTracks.add(play.title);
        if (play.grandparentTitle) { stats.uniqueArtists.add(play.grandparentTitle); }
        if (play.parentTitle) { stats.uniqueAlbums.add(play.parentTitle); }

        // Count plays for top lists
        stats.topTracks[play.title] = (stats.topTracks[play.title] || 0) + 1;
        if (play.grandparentTitle) {
          stats.topArtists[play.grandparentTitle] = (stats.topArtists[play.grandparentTitle] || 0) + 1;
        }
        if (play.parentTitle) {
          stats.topAlbums[play.parentTitle] = (stats.topAlbums[play.parentTitle] || 0) + 1;
        }

        // Analyze listening patterns
        const playDate = new Date(play.viewedAt * 1000);
        const hour = playDate.getHours();
        const dayOfWeek = playDate.getDay();
        const month = playDate.getMonth();

        stats.listeningPatterns.byHour[hour]++;
        stats.listeningPatterns.byDayOfWeek[dayOfWeek]++;
        stats.listeningPatterns.byMonth[month]++;
      }

      // Get detailed track information for genre analysis and recommendations
      await this.enrichMusicStats(stats, musicLibraries, plexUrl, plexToken);

      // Generate recommendations if requested
      if (includeRecommendations) {
        await this.generateMusicRecommendations(stats, musicLibraries, plexUrl, plexToken);
      }
    } catch (_error) {
      console.error('Error getting music history:', _error.message);
    }

    // Convert Sets to counts
    stats.uniqueTracks = stats.uniqueTracks.size;
    stats.uniqueArtists = stats.uniqueArtists.size;
    stats.uniqueAlbums = stats.uniqueAlbums.size;

    return stats;
  }

  async enrichMusicStats(stats, musicLibraries, plexUrl, plexToken) {
    // Get genre information from top tracks
    const topTrackNames = Object.keys(stats.topTracks).slice(0, 20); // Analyze top 20 tracks

    for (const library of musicLibraries) {
      try {
        // Search for tracks to get genre information
        for (const trackName of topTrackNames) {
          try {
            const searchResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/search`, {
              params: {
                'X-Plex-Token': plexToken,
                query: trackName,
                type: 10 // Track type
              },
              httpsAgent: this.getHttpsAgent()
            });

            const tracks = this.parseSearchResults(searchResponse.data);
            for (const track of tracks.slice(0, 1)) { // Just take first match
              if (track.key) {
                const trackDetailResponse = await this.axios.get(`${plexUrl}${track.key}`, {
                  params: { 'X-Plex-Token': plexToken },
                  httpsAgent: this.getHttpsAgent()
                });

                const trackDetail = trackDetailResponse.data?.MediaContainer?.Metadata?.[0];
                if (trackDetail && trackDetail.Genre) {
                  for (const genre of trackDetail.Genre) {
                    const playCount = stats.topTracks[trackName] || 1;
                    stats.topGenres[genre.tag] = (stats.topGenres[genre.tag] || 0) + playCount;
                  }
                }
              }
            }
          } catch (_trackError) {
            // Skip individual track errors
            continue;
          }
        }
      } catch (_libraryError) {
      }
    }
  }

  async generateMusicRecommendations(stats, musicLibraries, plexUrl, plexToken) {
    // Generate recommendations based on top genres and artists
    const topGenres = Object.entries(stats.topGenres)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([genre]) => genre);

    const topArtists = Object.keys(stats.topArtists).slice(0, 5);

    // Track artists we've already recommended to avoid duplicates
    const recommendedArtists = new Set(topArtists.map(a => a.toLowerCase()));

    for (const library of musicLibraries) {
      try {
        // Find new tracks in favorite genres
        for (const genre of topGenres.slice(0, 2)) {
          try {
            const genreSearchResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
              params: {
                'X-Plex-Token': plexToken,
                genre: genre,
                type: 10, // Track type
                'X-Plex-Container-Size': 10,
                sort: 'addedAt:desc' // Recently added first
              },
              httpsAgent: this.getHttpsAgent()
            });

            const tracks = this.parseLibraryContent(genreSearchResponse.data);
            for (const track of tracks.slice(0, 3)) {
              // Only recommend if not already in top tracks
              if (!stats.topTracks[track.title]) {
                stats.recommendations.push({
                  title: track.title,
                  artist: track.grandparentTitle || 'Unknown Artist',
                  album: track.parentTitle || 'Unknown Album',
                  reason: `Based on your interest in ${genre}`,
                  type: 'genre-based',
                  key: track.key
                });
              }
            }
          } catch (_genreError) {
            continue;
          }
        }

        // Find tracks by similar artists
        for (const artist of topArtists.slice(0, 2)) {
          try {
            const artistSearchResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/search`, {
              params: {
                'X-Plex-Token': plexToken,
                query: artist,
                type: 8 // Artist type
              },
              httpsAgent: this.getHttpsAgent()
            });

            const artists = this.parseSearchResults(artistSearchResponse.data);
            for (const foundArtist of artists.slice(0, 1)) {
              if (foundArtist.key) {
                const artistDetailResponse = await this.axios.get(`${plexUrl}${foundArtist.key}`, {
                  params: { 'X-Plex-Token': plexToken },
                  httpsAgent: this.getHttpsAgent()
                });

                const artistTracks = this.parseLibraryContent(artistDetailResponse.data);
                for (const track of artistTracks.slice(0, 2)) {
                  if (!stats.topTracks[track.title]) {
                    stats.recommendations.push({
                      title: track.title,
                      artist: artist,
                      album: track.parentTitle || 'Unknown Album',
                      reason: `More from ${artist}`,
                      type: 'artist-based',
                      key: track.key
                    });
                  }
                }
              }
            }
          } catch (_artistError) {
            continue;
          }
        }

        // Find similar artists based on genre overlap
        await this.findSimilarArtistRecommendations(
          stats,
          library,
          topGenres,
          topArtists,
          recommendedArtists,
          plexUrl,
          plexToken
        );
      } catch (_libraryError) {
        continue;
      }
    }

    // Limit recommendations to avoid overwhelming output
    stats.recommendations = stats.recommendations.slice(0, 12);
  }

  async findSimilarArtistRecommendations(stats, library, topGenres, topArtists, recommendedArtists, plexUrl, plexToken) {
    try {
      // Find artists in your top genres that you don't already listen to
      for (const genre of topGenres.slice(0, 2)) {
        try {
          const genreArtistsResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
            params: {
              'X-Plex-Token': plexToken,
              genre: genre,
              type: 8, // Artist type
              'X-Plex-Container-Size': 15,
              sort: 'titleSort'
            },
            httpsAgent: this.getHttpsAgent()
          });

          const artists = this.parseLibraryContent(genreArtistsResponse.data);

          // Find artists in this genre that aren't in your top artists
          const similarArtists = artists.filter(artist =>
            !recommendedArtists.has(artist.title.toLowerCase()) &&
            !topArtists.some(topArtist => topArtist.toLowerCase() === artist.title.toLowerCase())
          );

          // Get tracks from similar artists you haven't discovered yet
          for (const artist of similarArtists.slice(0, 2)) {
            try {
              const artistTracksResponse = await this.axios.get(`${plexUrl}${artist.key}`, {
                params: {
                  'X-Plex-Token': plexToken,
                  'X-Plex-Container-Size': 5
                },
                httpsAgent: this.getHttpsAgent()
              });

              const tracks = this.parseLibraryContent(artistTracksResponse.data);
              const unplayedTracks = tracks.filter(track => !stats.topTracks[track.title]);

              if (unplayedTracks.length > 0) {
                const recommendTrack = unplayedTracks[0];

                // Add some personality
                let reason = `You might dig ${artist.title} - they're in the ${genre} scene`;
                if (artist.title.toLowerCase().includes('nickelback')) {
                  reason = 'Found Nickelback in your library. We\'re not judging... much.';
                }

                stats.recommendations.push({
                  title: recommendTrack.title,
                  artist: artist.title,
                  album: recommendTrack.parentTitle || 'Unknown Album',
                  reason: reason,
                  type: 'similar-artist',
                  key: recommendTrack.key
                });

                recommendedArtists.add(artist.title.toLowerCase());

                // Stop if we have enough recommendations
                if (stats.recommendations.length >= 12) {
                  return;
                }
              }
            } catch (_trackError) {
              continue;
            }
          }
        } catch (_genreError) {
          continue;
        }
      }
    } catch (_error) {
      // Silently continue if similar artist discovery fails
    }
  }

  async processNaturalLanguageQuery(query, context, stats, musicLibraries, plexUrl, plexToken, limit) {
    const queryLower = query.toLowerCase();
    let results = [];
    let analysis = '';

    // Decade/year queries (like "90s songs", "music from the 2000s")
    if (queryLower.match(/\b(90s?|1990s?|2000s?|80s?|1980s?|70s?|1970s?)\b/)) {
      const yearMatch = queryLower.match(/\b(90s?|1990s?|2000s?|80s?|1980s?|70s?|1970s?)\b/);
      let yearRange = {};

      if (yearMatch[1].includes('90')) {
        yearRange = { min: 1989, max: 2000 };
        analysis = 'Looking for tracks from the 90s era...';
      } else if (yearMatch[1].includes('2000')) {
        yearRange = { min: 2000, max: 2009 };
        analysis = 'Searching for 2000s music...';
      } else if (yearMatch[1].includes('80')) {
        yearRange = { min: 1980, max: 1989 };
        analysis = 'Finding 80s classics...';
      } else if (yearMatch[1].includes('70')) {
        yearRange = { min: 1970, max: 1979 };
        analysis = 'Digging up 70s gems...';
      }

      results = await this.searchByDecade(musicLibraries, yearRange, stats, plexUrl, plexToken, limit);

      if (results.length > 0) {
        const tracksWithMeta = results.filter(r => r.hasMetadata).length;
        const tracksWithoutMeta = results.length - tracksWithMeta;

        analysis += ` Found ${results.length} tracks`;
        if (tracksWithoutMeta > 0) {
          analysis += ` (${tracksWithoutMeta} tracks missing year data - they might also be from this era but I can't tell)`;
        }
        analysis += '.';
      } else {
        analysis += ' Your library doesn\'t seem to have much from that decade, or the year metadata is missing.';
      }
    } else if (queryLower.match(/\b(like|similar to|sounds like)\s+(.+)/)) {
      // Similar artist queries ("like X", "similar to Y")
      const artistMatch = queryLower.match(/\b(like|similar to|sounds like)\s+(.+)/);
      const targetArtist = artistMatch[2].trim();

      analysis = `Looking for artists similar to ${targetArtist}...`;
      results = await this.findSimilarTo(targetArtist, musicLibraries, stats, plexUrl, plexToken, limit);

      if (results.length > 0) {
        analysis += ' Found some artists you might dig based on genre overlap and your listening patterns.';
      } else {
        analysis += ` Couldn't find similar artists. Either ${targetArtist} isn't in your library or there aren't similar artists available.`;
      }
    } else if (queryLower.match(/\b(haven't heard|never played|new|discover|unplayed)\b/)) {
      // Unheard/new discovery queries
      analysis = 'Finding music in your library you haven\'t explored yet...';
      results = await this.findUnheardMusic(musicLibraries, stats, plexUrl, plexToken, limit);

      if (results.length > 0) {
        analysis += ' Here are some tracks from your collection that you haven\'t played much (or at all).';
      } else {
        analysis += ' Looks like you\'ve been thorough with your library! Not much unplayed content found.';
      }
    } else if (queryLower.match(/\b(rock|jazz|hip hop|electronic|classical|folk|country|pop|metal|punk|indie|alternative)\b/)) {
      // Genre-based queries
      const genreMatch = queryLower.match(/\b(rock|jazz|hip hop|electronic|classical|folk|country|pop|metal|punk|indie|alternative)\b/);
      const genre = genreMatch[0];

      analysis = `Searching for ${genre} music in your library...`;
      results = await this.searchByGenre(genre, musicLibraries, stats, plexUrl, plexToken, limit);

      if (results.length > 0) {
        analysis += ` Found ${results.length} ${genre} tracks.`;

        // Add personality for specific genres
        if (genre === 'rock' && results.some(r => r.artist.toLowerCase().includes('nickelback'))) {
          analysis += ' (Yes, that includes your Nickelback collection. We see you.)';
        }
      }
    } else if (queryLower.match(/\b(energetic|upbeat|fast|slow|calm|mellow|acoustic|electronic|high bpm|low bpm|dance|chill)\b/)) {
      // Audio analysis queries (like "energetic songs", "high BPM tracks", "acoustic music")
      analysis = `Analyzing audio characteristics for "${query}"...`;
      results = await this.searchByAudioAnalysis(query, musicLibraries, plexUrl, plexToken, limit);
    } else {
      // General/fallback search
      analysis = `Searching your library for "${query}"...`;
      results = await this.generalSearch(query, musicLibraries, plexUrl, plexToken, limit);
    }

    return {
      analysis,
      results,
      query: query
    };
  }

  async searchByDecade(musicLibraries, yearRange, stats, plexUrl, plexToken, limit) {
    const results = [];

    for (const library of musicLibraries) {
      try {
        const response = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
          params: {
            'X-Plex-Token': plexToken,
            type: 10, // Track type
            'year>': yearRange.min - 1,
            'year<': yearRange.max + 1,
            'X-Plex-Container-Size': limit * 2,
            sort: 'random'
          },
          httpsAgent: this.getHttpsAgent()
        });

        const tracks = this.parseLibraryContent(response.data);

        tracks.forEach(track => {
          const playCount = stats.topTracks[track.title] || 0;
          results.push({
            title: track.title,
            artist: track.grandparentTitle || 'Unknown Artist',
            album: track.parentTitle || 'Unknown Album',
            year: track.year,
            playCount: playCount,
            hasMetadata: !!track.year,
            reason: `From ${yearRange.min === 1989 ? 'the 90s' : yearRange.min + 's'} - played ${playCount} times`,
            key: track.key
          });
        });

        if (results.length >= limit) { break; }
      } catch (_error) {
        continue;
      }
    }

    return results.slice(0, limit);
  }

  async findSimilarTo(targetArtist, musicLibraries, stats, plexUrl, plexToken, limit) {
    const results = [];

    // First, find the target artist's genre(s)
    let targetGenres = [];

    for (const library of musicLibraries) {
      try {
        const artistResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/search`, {
          params: {
            'X-Plex-Token': plexToken,
            query: targetArtist,
            type: 8 // Artist type
          },
          httpsAgent: this.getHttpsAgent()
        });

        const artists = this.parseSearchResults(artistResponse.data);
        if (artists.length > 0) {
          // Get artist details to find genres
          const artistDetailResponse = await this.axios.get(`${plexUrl}${artists[0].key}`, {
            params: { 'X-Plex-Token': plexToken },
            httpsAgent: this.getHttpsAgent()
          });

          const artistData = this.parseLibraryContent(artistDetailResponse.data);
          // Extract genres from artist metadata (this might need adjustment based on actual Plex API response)
          if (artistData.genre) {
            targetGenres = Array.isArray(artistData.genre) ? artistData.genre : [artistData.genre];
          }
          break;
        }
      } catch (_error) {
        continue;
      }
    }

    // If we found genres, search for other artists in those genres
    if (targetGenres.length > 0) {
      return await this.findSimilarArtistsByGenre(targetGenres, targetArtist, musicLibraries, stats, plexUrl, plexToken, limit);
    }

    return results;
  }

  async findSimilarArtistsByGenre(genres, excludeArtist, musicLibraries, stats, plexUrl, plexToken, limit) {
    const results = [];
    const seenArtists = new Set([excludeArtist.toLowerCase()]);

    for (const genre of genres.slice(0, 2)) {
      for (const library of musicLibraries) {
        try {
          const response = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
            params: {
              'X-Plex-Token': plexToken,
              genre: genre,
              type: 10, // Track type
              'X-Plex-Container-Size': 20,
              sort: 'random'
            },
            httpsAgent: this.getHttpsAgent()
          });

          const tracks = this.parseLibraryContent(response.data);

          tracks.forEach(track => {
            const artist = track.grandparentTitle || 'Unknown Artist';
            if (!seenArtists.has(artist.toLowerCase())) {
              const playCount = stats.topTracks[track.title] || 0;

              results.push({
                title: track.title,
                artist: artist,
                album: track.parentTitle || 'Unknown Album',
                playCount: playCount,
                reason: `Similar to ${excludeArtist} (both in ${genre})`,
                key: track.key
              });

              seenArtists.add(artist.toLowerCase());

              if (results.length >= limit) { return; }
            }
          });
        } catch (_error) {
          continue;
        }
      }
    }

    return results.slice(0, limit);
  }

  async findUnheardMusic(musicLibraries, stats, plexUrl, plexToken, limit) {
    const results = [];

    for (const library of musicLibraries) {
      try {
        const response = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
          params: {
            'X-Plex-Token': plexToken,
            type: 10, // Track type
            'X-Plex-Container-Size': limit * 3,
            sort: 'random'
          },
          httpsAgent: this.getHttpsAgent()
        });

        const tracks = this.parseLibraryContent(response.data);

        tracks.forEach(track => {
          const playCount = stats.topTracks[track.title] || 0;
          if (playCount === 0) {
            results.push({
              title: track.title,
              artist: track.grandparentTitle || 'Unknown Artist',
              album: track.parentTitle || 'Unknown Album',
              playCount: 0,
              reason: 'Never played - time to discover something new!',
              key: track.key
            });
          }
        });

        if (results.length >= limit) { break; }
      } catch (_error) {
        continue;
      }
    }

    return results.slice(0, limit);
  }

  async searchByGenre(genre, musicLibraries, stats, plexUrl, plexToken, limit) {
    const results = [];

    for (const library of musicLibraries) {
      try {
        const response = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
          params: {
            'X-Plex-Token': plexToken,
            genre: genre,
            type: 10, // Track type
            'X-Plex-Container-Size': limit,
            sort: 'random'
          },
          httpsAgent: this.getHttpsAgent()
        });

        const tracks = this.parseLibraryContent(response.data);

        tracks.forEach(track => {
          const playCount = stats.topTracks[track.title] || 0;
          results.push({
            title: track.title,
            artist: track.grandparentTitle || 'Unknown Artist',
            album: track.parentTitle || 'Unknown Album',
            playCount: playCount,
            reason: `${genre.charAt(0).toUpperCase() + genre.slice(1)} track - played ${playCount} times`,
            key: track.key
          });
        });

        if (results.length >= limit) { break; }
      } catch (_error) {
        continue;
      }
    }

    return results.slice(0, limit);
  }

  async generalSearch(query, musicLibraries, plexUrl, plexToken, limit) {
    const results = [];

    for (const library of musicLibraries) {
      try {
        const response = await this.axios.get(`${plexUrl}/library/sections/${library.key}/search`, {
          params: {
            'X-Plex-Token': plexToken,
            query: query,
            type: 10, // Track type
            'X-Plex-Container-Size': limit
          },
          httpsAgent: this.getHttpsAgent()
        });

        const tracks = this.parseSearchResults(response.data);

        tracks.forEach(track => {
          results.push({
            title: track.title,
            artist: track.artist || 'Unknown Artist',
            album: track.album || 'Unknown Album',
            reason: `Matches "${query}"`,
            key: track.key
          });
        });

        if (results.length >= limit) { break; }
      } catch (_error) {
        continue;
      }
    }

    return results.slice(0, limit);
  }

  formatListeningStats(stats, includeRecommendations) {
    let formatted = '**Overview:**\\n';
    formatted += `   Total Plays: ${stats.totalPlays.toLocaleString()}\\n`;

    if (stats.totalListeningTime > 0) {
      const totalHours = Math.floor(stats.totalListeningTime / 3600000);
      const totalDays = Math.floor(totalHours / 24);
      if (totalDays > 1) {
        formatted += `   Listening Time: ${totalDays} days (${totalHours.toLocaleString()} hours)\\n`;
      } else {
        formatted += `   Listening Time: ${totalHours.toLocaleString()} hours\\n`;
      }
    }

    formatted += `   Unique Tracks: ${stats.uniqueTracks.toLocaleString()}\\n`;
    formatted += `   Unique Artists: ${stats.uniqueArtists.toLocaleString()}\\n`;
    formatted += `   Unique Albums: ${stats.uniqueAlbums.toLocaleString()}\\n`;

    // Top tracks
    if (Object.keys(stats.topTracks).length > 0) {
      formatted += '\\n**Top Tracks:**\\n';
      const sortedTracks = Object.entries(stats.topTracks)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      sortedTracks.forEach(([track, count], index) => {
        formatted += `   ${index + 1}. ${track} (${count} plays)\\n`;
      });
    }

    // Top artists
    if (Object.keys(stats.topArtists).length > 0) {
      formatted += '\\n**Top Artists:**\\n';
      const sortedArtists = Object.entries(stats.topArtists)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      sortedArtists.forEach(([artist, count], index) => {
        formatted += `   ${index + 1}. ${artist} (${count} plays)\\n`;
      });
    }

    // Top albums
    if (Object.keys(stats.topAlbums).length > 0) {
      formatted += '\\n**Top Albums:**\\n';
      const sortedAlbums = Object.entries(stats.topAlbums)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

      sortedAlbums.forEach(([album, count], index) => {
        formatted += `   ${index + 1}. ${album} (${count} plays)\\n`;
      });
    }

    // Top genres
    if (Object.keys(stats.topGenres).length > 0) {
      formatted += '\\n**Top Genres:**\\n';
      const sortedGenres = Object.entries(stats.topGenres)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);

      sortedGenres.forEach(([genre, count], index) => {
        formatted += `   ${index + 1}. ${genre} (${count} plays)\\n`;
      });
    }

    // Listening patterns
    formatted += '\\n**Listening Patterns:**\\n';

    // Peak listening hour
    const peakHourIndex = stats.listeningPatterns.byHour.indexOf(Math.max(...stats.listeningPatterns.byHour));
    const peakHour = peakHourIndex === 0 ? '12 AM' :
      peakHourIndex < 12 ? `${peakHourIndex} AM` :
        peakHourIndex === 12 ? '12 PM' : `${peakHourIndex - 12} PM`;
    formatted += `   Peak listening hour: ${peakHour}\\n`;

    // Most active day
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDayIndex = stats.listeningPatterns.byDayOfWeek.indexOf(Math.max(...stats.listeningPatterns.byDayOfWeek));
    formatted += `   Most active day: ${dayNames[peakDayIndex]}\\n`;

    // Peak month (if data spans multiple months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsWithData = stats.listeningPatterns.byMonth.filter(count => count > 0).length;
    if (monthsWithData > 1) {
      const peakMonthIndex = stats.listeningPatterns.byMonth.indexOf(Math.max(...stats.listeningPatterns.byMonth));
      formatted += `   Peak month: ${monthNames[peakMonthIndex]}\\n`;
    }

    // Recommendations
    if (includeRecommendations && stats.recommendations.length > 0) {
      formatted += '\\n**Recommendations for You:**\\n';
      stats.recommendations.forEach((rec, index) => {
        formatted += `   ${index + 1}. **${rec.title}** by ${rec.artist}\\n`;
        formatted += `      ${rec.reason}\\n`;
        if (rec.album && rec.album !== 'Unknown Album') {
          formatted += `      Album: ${rec.album}\\n`;
        }
      });
    }

    return formatted;
  }

  setupResourceHandlers() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async() => {
      const resources = [];

      try {
        // Only provide resources if we can authenticate
        const plexToken = await this.authManager.getAuthToken();
        if (!plexToken) {
          return { resources: [] };
        }

        const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';

        // Get libraries to create dynamic resources
        const librariesUrl = `${plexUrl}/library/sections`;
        const response = await this.axios.get(librariesUrl, {
          params: { 'X-Plex-Token': plexToken },
          httpsAgent: this.getHttpsAgent(),
          timeout: 10000
        });

        if (response.data?.MediaContainer?.Directory) {
          for (const library of response.data.MediaContainer.Directory) {
            resources.push({
              uri: `plex://library/${library.key}`,
              name: `${library.title} Library`,
              description: `Access all content in the ${library.title} library (${library.type})`,
              mimeType: 'application/json'
            });

            // Add recently added for each library
            resources.push({
              uri: `plex://library/${library.key}/recent`,
              name: `${library.title} - Recently Added`,
              description: `Recently added content from ${library.title} library`,
              mimeType: 'application/json'
            });
          }
        }

        // Add global resources
        resources.push(
          {
            uri: 'plex://libraries',
            name: 'All Libraries',
            description: 'List of all Plex libraries with their metadata',
            mimeType: 'application/json'
          },
          {
            uri: 'plex://recent',
            name: 'Recently Added Content',
            description: 'Recently added content across all libraries',
            mimeType: 'application/json'
          },
          {
            uri: 'plex://playlists',
            name: 'All Playlists',
            description: 'List of all playlists on the server',
            mimeType: 'application/json'
          },
          {
            uri: 'plex://on-deck',
            name: 'Continue Watching',
            description: "Content that's currently being watched (on deck)",
            mimeType: 'application/json'
          },
          {
            uri: 'plex://stats',
            name: 'Server Statistics',
            description: 'Library statistics and storage information',
            mimeType: 'application/json'
          }
        );
      } catch (_error) {
        console.error('Error listing resources:', _error.message);
        // Return basic resources even if we can't connect
        resources.push({
          uri: 'plex://status',
          name: 'Connection Status',
          description: 'Current Plex server connection status',
          mimeType: 'application/json'
        });
      }

      return { resources };
    });

    // Read specific resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async(request) => {
      const { uri } = request.params;

      try {
        const plexToken = await this.authManager.getAuthToken();
        const plexUrl = process.env.PLEX_URL || 'https://app.plex.tv';

        if (uri === 'plex://status') {
          const status = await this.verifyConnection();
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(status, null, 2)
            }]
          };
        }

        if (!plexToken) {
          throw new Error('Authentication required to access this resource');
        }

        if (uri === 'plex://libraries') {
          const response = await this.axios.get(`${plexUrl}/library/sections`, {
            params: { 'X-Plex-Token': plexToken },
            httpsAgent: this.getHttpsAgent(),
            timeout: 10000
          });
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response.data?.MediaContainer, null, 2)
            }]
          };
        }

        if (uri === 'plex://recent') {
          const response = await this.axios.get(`${plexUrl}/library/recentlyAdded`, {
            params: { 'X-Plex-Token': plexToken },
            httpsAgent: this.getHttpsAgent(),
            timeout: 15000
          });
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response.data?.MediaContainer, null, 2)
            }]
          };
        }

        if (uri === 'plex://playlists') {
          const response = await this.axios.get(`${plexUrl}/playlists`, {
            params: { 'X-Plex-Token': plexToken },
            httpsAgent: this.getHttpsAgent(),
            timeout: 10000
          });
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response.data?.MediaContainer, null, 2)
            }]
          };
        }

        if (uri === 'plex://on-deck') {
          const response = await this.axios.get(`${plexUrl}/library/onDeck`, {
            params: { 'X-Plex-Token': plexToken },
            httpsAgent: this.getHttpsAgent(),
            timeout: 10000
          });
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response.data?.MediaContainer, null, 2)
            }]
          };
        }

        if (uri === 'plex://stats') {
          const stats = await this.getLibraryStatsInternal(plexToken, plexUrl);
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(stats, null, 2)
            }]
          };
        }

        // Handle library-specific resources: plex://library/{id} or plex://library/{id}/recent
        const libraryMatch = uri.match(/^plex:\/\/library\/(\d+)(\/recent)?$/);
        if (libraryMatch) {
          const libraryId = libraryMatch[1];
          const isRecent = !!libraryMatch[2];

          let endpoint;
          if (isRecent) {
            endpoint = `${plexUrl}/library/sections/${libraryId}/recentlyAdded`;
          } else {
            endpoint = `${plexUrl}/library/sections/${libraryId}/all`;
          }

          const response = await this.axios.get(endpoint, {
            params: { 'X-Plex-Token': plexToken },
            httpsAgent: this.getHttpsAgent(),
            timeout: 15000
          });

          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response.data?.MediaContainer, null, 2)
            }]
          };
        }

        throw new Error(`Unknown resource URI: ${uri}`);
      } catch (_error) {
        console.error(`Error reading resource ${uri}:`, _error.message);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ error: _error.message }, null, 2)
          }]
        };
      }
    });
  }

  setupPromptHandlers() {
    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async() => {
      return {
        prompts: [
          {
            name: 'playlist_description',
            description: 'Generate a creative description for a playlist',
            arguments: [
              {
                name: 'playlist_name',
                description: 'Name of the playlist',
                required: true
              },
              {
                name: 'genre',
                description: 'Primary genre or mood of the playlist',
                required: false
              },
              {
                name: 'content_info',
                description: 'Information about the content in the playlist',
                required: false
              }
            ]
          },
          {
            name: 'content_recommendation',
            description: 'Generate content recommendations based on viewing history or preferences',
            arguments: [
              {
                name: 'liked_content',
                description: 'Titles of content the user has enjoyed',
                required: true
              },
              {
                name: 'content_type',
                description: 'Type of content to recommend (movies, tv shows, music, etc.)',
                required: false
              },
              {
                name: 'mood_or_genre',
                description: 'Specific mood or genre preferences',
                required: false
              }
            ]
          },
          {
            name: 'smart_playlist_rules',
            description: 'Generate smart playlist criteria and rules',
            arguments: [
              {
                name: 'intent',
                description: 'What kind of smart playlist you want to create',
                required: true
              },
              {
                name: 'library_type',
                description: 'Type of library (music, movies, tv shows)',
                required: false
              }
            ]
          },
          {
            name: 'media_analysis',
            description: 'Analyze and categorize media content',
            arguments: [
              {
                name: 'content_data',
                description: 'JSON data about the media content',
                required: true
              },
              {
                name: 'analysis_type',
                description: 'Type of analysis (genre patterns, viewing trends, collection gaps, etc.)',
                required: false
              }
            ]
          },
          {
            name: 'server_troubleshooting',
            description: 'Help diagnose Plex server connection or performance issues',
            arguments: [
              {
                name: 'error_details',
                description: 'Details about the error or issue encountered',
                required: true
              },
              {
                name: 'server_info',
                description: 'Information about the server setup and configuration',
                required: false
              }
            ]
          }
        ]
      };
    });

    // Get specific prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async(request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'playlist_description':
          const playlistName = args?.playlist_name || 'Your Playlist';
          const genre = args?.genre || '';
          const contentInfo = args?.content_info || '';

          return {
            description: `Generate a creative and engaging description for the playlist "${playlistName}"`,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Create a creative, engaging description for a playlist called "${playlistName}"${genre ? ` in the ${genre} genre` : ''}${contentInfo ? `.\n\nPlaylist content information:\n${contentInfo}` : ''}.

The description should:
- Be 2-3 sentences long
- Capture the mood and vibe of the playlist
- Be engaging and make people want to listen/watch
- Use vivid, descriptive language
${genre ? `- Reflect the ${genre} genre characteristics` : ''}

Make it sound compelling and professional, like something you'd see on a streaming service.`
                }
              }
            ]
          };

        case 'content_recommendation':
          const likedContent = args?.liked_content || '';
          const contentType = args?.content_type || 'content';
          const moodOrGenre = args?.mood_or_genre || '';

          return {
            description: 'Generate personalized content recommendations',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Based on these titles I've enjoyed: ${likedContent}

Please recommend similar ${contentType}${moodOrGenre ? ` in the ${moodOrGenre} style` : ''}.

For each recommendation, provide:
- Title and year
- Brief explanation of why it's similar to what I liked
- What makes it appealing
- Any notable cast, creators, or standout features

Focus on finding hidden gems and quality content that matches my taste preferences shown in the titles I mentioned.`
                }
              }
            ]
          };

        case 'smart_playlist_rules':
          const intent = args?.intent || '';
          const libraryType = args?.library_type || 'media';

          return {
            description: 'Generate smart playlist criteria and filtering rules',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `I want to create a smart playlist for: ${intent}

Library type: ${libraryType}

Please suggest specific filtering criteria and rules that would work well for this playlist, including:
- Recommended filters (genre, year, rating, etc.)
- Sorting preferences
- Any advanced criteria that would enhance the playlist
- Tips for keeping the playlist fresh and relevant

Provide practical, actionable suggestions that would create a great automated playlist.`
                }
              }
            ]
          };

        case 'media_analysis':
          const contentData = args?.content_data || '';
          const analysisType = args?.analysis_type || 'general analysis';

          return {
            description: 'Analyze media library content and patterns',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Please analyze this media library data for ${analysisType}:

${contentData}

Provide insights about:
- Patterns and trends in the collection
- Genre distribution and preferences
- Quality and completeness of the library
- Recommendations for improvement or expansion
- Any interesting observations about the content

Format the analysis in a clear, organized way that's easy to understand and actionable.`
                }
              }
            ]
          };

        case 'server_troubleshooting':
          const errorDetails = args?.error_details || '';
          const serverInfo = args?.server_info || '';

          return {
            description: 'Help diagnose and resolve Plex server issues',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `I'm having an issue with my Plex server. Here are the details:

Error/Issue: ${errorDetails}

${serverInfo ? `Server Information:\n${serverInfo}\n` : ''}

Please help me:
1. Understand what might be causing this issue
2. Provide step-by-step troubleshooting steps
3. Suggest preventive measures for the future
4. Identify if this is a common issue with known solutions

Focus on practical, actionable solutions that don't require advanced technical expertise.`
                }
              }
            ]
          };

        default:
          throw new Error(`Unknown prompt: ${name}`);
      }
    });
  }

  async getLibraryStatsInternal(plexToken, plexUrl) {
    try {
      const response = await this.axios.get(`${plexUrl}/library/sections`, {
        params: { 'X-Plex-Token': plexToken },
        httpsAgent: this.getHttpsAgent(),
        timeout: 10000
      });

      const libraries = response.data?.MediaContainer?.Directory || [];
      const stats = {
        totalLibraries: libraries.length,
        libraries: []
      };

      for (const library of libraries) {
        const libResponse = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
          params: { 'X-Plex-Token': plexToken },
          httpsAgent: this.getHttpsAgent(),
          timeout: 15000
        });

        const libStats = {
          name: library.title,
          type: library.type,
          itemCount: libResponse.data?.MediaContainer?.size || 0,
          agent: library.agent,
          scanner: library.scanner,
          language: library.language,
          refreshing: library.refreshing || false,
          createdAt: library.createdAt,
          updatedAt: library.updatedAt
        };

        stats.libraries.push(libStats);
      }

      return stats;
    } catch (_error) {
      return { error: `Failed to get library stats: ${_error.message}` };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Plex MCP server running on stdio');
  }

  async searchByAudioAnalysis(query, musicLibraries, plexUrl, plexToken, limit) {
    const queryLower = query.toLowerCase();
    const results = [];

    // Map query terms to search parameters
    let searchParams = {};

    if (queryLower.includes('energetic') || queryLower.includes('upbeat') || queryLower.includes('dance')) {
      searchParams.mood = 'energetic';
      searchParams.bpmMin = 120; // Typical dance/energetic BPM
    } else if (queryLower.includes('calm') || queryLower.includes('mellow') || queryLower.includes('chill')) {
      searchParams.mood = 'calm';
      searchParams.bpmMax = 100; // Slower, calmer tempo
    } else if (queryLower.includes('fast') || queryLower.includes('high bpm')) {
      searchParams.bpmMin = 140;
    } else if (queryLower.includes('slow') || queryLower.includes('low bpm')) {
      searchParams.bpmMax = 80;
    } else if (queryLower.includes('acoustic')) {
      searchParams.acoustic_ratio_min = 0.7; // Mostly acoustic
    } else if (queryLower.includes('electronic')) {
      searchParams.acoustic_ratio_max = 0.3; // Mostly electronic
    }

    // For now, since we don't have real audio analysis data from Plex yet,
    // we'll search based on genre and try to infer characteristics
    for (const library of musicLibraries) {
      try {
        const response = await this.axios.get(`${plexUrl}/library/sections/${library.key}/all`, {
          params: {
            'X-Plex-Token': plexToken,
            type: 10, // Track type
            'X-Plex-Container-Size': limit * 2,
            sort: 'random'
          },
          httpsAgent: this.getHttpsAgent()
        });

        const tracks = this.parseLibraryContent(response.data);

        // Filter tracks based on genre hints for audio characteristics
        tracks.forEach(track => {
          let matches = false;
          let reason = '';

          // Use genre to infer audio characteristics until real analysis data is available
          const genre = (track.genre || '').toLowerCase();

          if (searchParams.mood === 'energetic') {
            matches = genre.includes('dance') || genre.includes('electronic') ||
                     genre.includes('rock') || genre.includes('pop') || genre.includes('hip hop');
            reason = `Energetic track (${track.genre || 'Unknown Genre'})`;
          } else if (searchParams.mood === 'calm') {
            matches = genre.includes('ambient') || genre.includes('classical') ||
                     genre.includes('jazz') || genre.includes('folk') || genre.includes('acoustic');
            reason = `Calm/mellow track (${track.genre || 'Unknown Genre'})`;
          } else if (searchParams.bpmMin === 140) {
            matches = genre.includes('drum') || genre.includes('electronic') ||
                     genre.includes('dance') || genre.includes('techno');
            reason = `Fast-tempo track (${track.genre || 'Unknown Genre'})`;
          } else if (searchParams.bpmMax === 80) {
            matches = genre.includes('ballad') || genre.includes('ambient') ||
                     genre.includes('downtempo') || genre.includes('folk');
            reason = `Slow-tempo track (${track.genre || 'Unknown Genre'})`;
          } else if (searchParams.acoustic_ratio_min === 0.7) {
            matches = genre.includes('acoustic') || genre.includes('folk') ||
                     genre.includes('country') || genre.includes('singer-songwriter');
            reason = `Acoustic track (${track.genre || 'Unknown Genre'})`;
          } else if (searchParams.acoustic_ratio_max === 0.3) {
            matches = genre.includes('electronic') || genre.includes('synth') ||
                     genre.includes('techno') || genre.includes('edm');
            reason = `Electronic track (${track.genre || 'Unknown Genre'})`;
          }

          if (matches) {
            results.push({
              title: track.title,
              artist: track.grandparentTitle || 'Unknown Artist',
              album: track.parentTitle || 'Unknown Album',
              year: track.year,
              genre: track.genre,
              hasMetadata: !!track.genre,
              reason: reason,
              // Estimated audio characteristics (placeholders for real analysis)
              estimatedBPM: this.estimateBPMFromGenre(track.genre),
              estimatedMood: this.estimateMoodFromGenre(track.genre),
              estimatedAcousticRatio: this.estimateAcousticRatioFromGenre(track.genre)
            });
          }
        });
      } catch (_error) {
        console.error(`Error searching library ${library.key} for audio analysis:`, _error.message);
      }
    }

    // Shuffle and limit results
    for (let i = results.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [results[i], results[j]] = [results[j], results[i]];
    }

    return results.slice(0, limit);
  }

  calculateAudioQuality(media) {
    if (!media) { return null; }

    let score = 0;
    let factors = [];

    // Bitrate scoring (if available)
    if (media.bitrate) {
      if (media.bitrate >= 1000) {
        score += 30;
        factors.push('High bitrate');
      } else if (media.bitrate >= 500) {
        score += 20;
        factors.push('Good bitrate');
      } else if (media.bitrate >= 256) {
        score += 10;
        factors.push('Decent bitrate');
      } else {
        factors.push('Low bitrate');
      }
    }

    // Codec scoring
    if (media.audioCodec) {
      const codec = media.audioCodec.toLowerCase();
      if (['flac', 'alac', 'dts', 'truehd'].includes(codec)) {
        score += 25;
        factors.push('Lossless codec');
      } else if (['aac', 'ogg'].includes(codec)) {
        score += 15;
        factors.push('Good codec');
      } else if (codec === 'mp3') {
        score += 10;
        factors.push('Standard codec');
      }
    }

    // Channel count scoring
    if (media.audioChannels) {
      if (media.audioChannels >= 6) {
        score += 15;
        factors.push('Surround sound');
      } else if (media.audioChannels === 2) {
        score += 10;
        factors.push('Stereo');
      }
    }

    // Dynamic range placeholder (would need real analysis)
    if (media.dynamicRange) {
      if (media.dynamicRange > 15) {
        score += 20;
        factors.push('Excellent dynamic range');
      } else if (media.dynamicRange > 10) {
        score += 10;
        factors.push('Good dynamic range');
      }
    }

    let rating;
    if (score >= 80) {
      rating = 'Excellent';
    } else if (score >= 60) {
      rating = 'Good';
    } else if (score >= 40) {
      rating = 'Fair';
    } else {
      rating = 'Poor';
    }
    return {
      score: Math.min(score, 100),
      rating: rating,
      factors: factors
    };
  }

  estimateBPMFromGenre(genre) {
    if (!genre) { return null; }
    const genreLower = genre.toLowerCase();

    if (genreLower.includes('drum') || genreLower.includes('dnb')) { return 170; }
    if (genreLower.includes('techno') || genreLower.includes('trance')) { return 130; }
    if (genreLower.includes('house') || genreLower.includes('dance')) { return 125; }
    if (genreLower.includes('pop') || genreLower.includes('rock')) { return 120; }
    if (genreLower.includes('hip hop') || genreLower.includes('rap')) { return 95; }
    if (genreLower.includes('ballad') || genreLower.includes('ambient')) { return 70; }
    if (genreLower.includes('classical') || genreLower.includes('folk')) { return 80; }

    return null; // Unknown
  }

  estimateMoodFromGenre(genre) {
    if (!genre) { return null; }
    const genreLower = genre.toLowerCase();

    if (genreLower.includes('dance') || genreLower.includes('electronic') || genreLower.includes('pop')) { return 'energetic'; }
    if (genreLower.includes('ambient') || genreLower.includes('classical') || genreLower.includes('folk')) { return 'calm'; }
    if (genreLower.includes('rock') || genreLower.includes('metal')) { return 'aggressive'; }
    if (genreLower.includes('jazz') || genreLower.includes('blues')) { return 'melancholic'; }
    if (genreLower.includes('gospel') || genreLower.includes('uplifting')) { return 'uplifting'; }

    return null; // Unknown
  }

  estimateAcousticRatioFromGenre(genre) {
    if (!genre) { return null; }
    const genreLower = genre.toLowerCase();

    if (genreLower.includes('acoustic') || genreLower.includes('folk') || genreLower.includes('country')) { return 0.9; }
    if (genreLower.includes('classical') || genreLower.includes('jazz')) { return 0.8; }
    if (genreLower.includes('electronic') || genreLower.includes('synth') || genreLower.includes('techno')) { return 0.1; }
    if (genreLower.includes('rock') || genreLower.includes('pop')) { return 0.5; }

    return null; // Unknown
  }
}

if (require.main === module) {
  const server = new PlexMCPServer();
  server.run().catch(console.error);
}

module.exports = PlexMCPServer;
