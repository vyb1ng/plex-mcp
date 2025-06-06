# End-to-End Tests for Live Plex Server

These tests validate the Plex MCP server against a real, running Plex instance.

## Setup

1. **Set environment variables** for your live Plex server:
   ```bash
   export PLEX_URL="https://your-plex-server:32400"
   export PLEX_TOKEN="your-plex-token"
   ```

2. **Optional: Configure SSL verification**:
   ```bash
   # For self-signed certificates
   export PLEX_VERIFY_SSL="false"
   ```

## Running E2E Tests

```bash
# Run only E2E tests against live server (will skip if no real credentials)
npm run test:e2e

# Run all tests (unit + integration + E2E)
npm run test:all

# Regular tests (excludes E2E - recommended for CI/development)
npm test
```

## Expected Output

**Without real credentials:**
```
Test Suites: 1 skipped, 0 of 1 total
Tests:       7 skipped, 7 total
```

**With real credentials:**
```
E2E Live Plex Server Tests
  ✓ should connect to live Plex server and retrieve library data
  ✓ should handle SSL verification based on PLEX_VERIFY_SSL setting
  ✓ should retrieve library list from live Plex server
  ...
```

## Test Coverage

The E2E tests verify:

- **Server Connectivity**: Can connect to live Plex server and retrieve server info
- **SSL Configuration**: Tests both SSL verification enabled/disabled modes
- **Library Retrieval**: Gets library list and browses library content
- **Search Functionality**: Performs searches against live data
- **Error Handling**: Tests invalid searches and library keys

### 🧪 **Specialized Analysis Tests**

Additional detailed analysis tests for debugging API behavior:

- **`playlist-behavior-analysis.test.js`**: Comprehensive playlist operation analysis
- **`remove-bug-investigation.test.js`**: 🚨 Critical remove operation bug investigation  
- **`multiple-item-add-test.test.js`**: Multi-item addition behavior analysis

These tests help diagnose:
- Why remove operations may delete entire playlists
- Whether multiple-item additions work correctly
- Accuracy of operation result messages
- Patterns in API response behavior

## Test Behavior

- **Automatic Skipping**: Tests skip automatically if `PLEX_URL` or `PLEX_TOKEN` are not set
- **Timeouts**: Extended timeouts (10-15 seconds) for network requests
- **Non-Destructive**: Tests only read data, no modifications to your Plex server
- **Graceful Failures**: Tests expect either success or specific error patterns

## Security Notes

- Use a **test environment** or **read-only** Plex token when possible
- The E2E tests only perform read operations (search, browse, get info)
- Your Plex credentials are only used locally for testing

## Troubleshooting

- **Connection Errors**: Verify `PLEX_URL` is accessible and `PLEX_TOKEN` is valid
- **SSL Errors**: Try setting `PLEX_VERIFY_SSL=false` for self-signed certificates
- **Timeout Errors**: Increase Jest timeout or check network connectivity