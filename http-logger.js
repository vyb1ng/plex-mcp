/**
 * HTTP Logger - A reusable HTTP logging utility for MCP servers
 * 
 * Features:
 * - Request/response logging with correlation IDs
 * - Comprehensive diagnostic information
 * - Configurable debug levels
 * - Header sanitization for security
 * - Connection and TLS error details
 * - Performance timing
 * - Structured JSON output
 */

class HttpLogger {
  constructor(options = {}) {
    this.debugLogging = options.debug ?? (process.env.MCP_HTTP_DEBUG === 'true');
    this.logLevel = options.logLevel || 'debug';
    this.requestCounter = 0;
    this.serviceName = options.serviceName || 'mcp-server';
  }

  /**
   * Generate unique correlation ID for request tracking
   */
  generateCorrelationId() {
    return `req_${Date.now()}_${++this.requestCounter}`;
  }

  /**
   * Log HTTP request details
   */
  logRequest(config, correlationId) {
    if (!this.debugLogging) return;

    const logData = {
      type: 'HTTP_REQUEST',
      service: this.serviceName,
      correlationId,
      timestamp: new Date().toISOString(),
      request: {
        method: config.method?.toUpperCase() || 'GET',
        url: config.url,
        baseURL: config.baseURL,
        fullUrl: this.buildFullUrl(config),
        headers: this.sanitizeHeaders(config.headers || {}),
        params: config.params,
        timeout: config.timeout,
        httpsAgent: config.httpsAgent ? 'configured' : 'default',
        maxRedirects: config.maxRedirects,
        validateStatus: typeof config.validateStatus === 'function' ? 'custom' : 'default'
      }
    };

    this.log('debug', JSON.stringify(logData, null, 2));
  }

  /**
   * Log HTTP response details
   */
  logResponse(response, correlationId, startTime) {
    if (!this.debugLogging) return;

    const duration = Date.now() - startTime;
    const logData = {
      type: 'HTTP_RESPONSE',
      service: this.serviceName,
      correlationId,
      timestamp: new Date().toISOString(),
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: this.sanitizeHeaders(response.headers || {}),
        duration: `${duration}ms`,
        dataSize: this.getDataSize(response.data),
        url: response.config?.url,
        method: response.config?.method?.toUpperCase(),
        redirected: response.request?._redirectCount > 0,
        redirectCount: response.request?._redirectCount || 0
      },
      performance: {
        totalTime: duration,
        dnsLookup: this.extractTimingInfo(response, 'lookup'),
        tcpConnection: this.extractTimingInfo(response, 'connect'),
        tlsHandshake: this.extractTimingInfo(response, 'secureConnect'),
        serverProcessing: this.extractTimingInfo(response, 'response')
      }
    };

    this.log('debug', JSON.stringify(logData, null, 2));
  }

  /**
   * Log HTTP errors with comprehensive diagnostic information
   */
  logError(error, correlationId, startTime) {
    if (!this.debugLogging) return;

    const duration = startTime ? Date.now() - startTime : null;
    const logData = {
      type: 'HTTP_ERROR',
      service: this.serviceName,
      correlationId,
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers ? this.sanitizeHeaders(error.response.headers) : undefined,
        data: error.response?.data ? this.truncateData(error.response.data) : undefined
      },
      request: {
        url: error.config?.url,
        method: error.config?.method?.toUpperCase(),
        timeout: error.config?.timeout,
        duration: duration ? `${duration}ms` : 'unknown'
      },
      connectionInfo: this.getConnectionInfo(error),
      troubleshooting: this.getTroubleshootingInfo(error)
    };

    this.log('error', JSON.stringify(logData, null, 2));
  }

  /**
   * Sanitize headers to remove sensitive information
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitivePatterns = [
      'token', 'authorization', 'cookie', 'auth', 'key', 'secret', 'password'
    ];
    
    Object.keys(sanitized).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (sensitivePatterns.some(pattern => lowerKey.includes(pattern))) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Get human-readable data size
   */
  getDataSize(data) {
    if (!data) return '0 bytes';
    
    try {
      const size = typeof data === 'string' ? data.length : JSON.stringify(data).length;
      if (size < 1024) return `${size} bytes`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
      return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Extract connection and network diagnostic information
   */
  getConnectionInfo(error) {
    const info = {};
    
    if (error.code) info.errorCode = error.code;
    if (error.address) info.address = error.address;
    if (error.port) info.port = error.port;
    if (error.syscall) info.syscall = error.syscall;
    if (error.errno) info.errno = error.errno;
    
    // DNS resolution errors
    if (error.code === 'ENOTFOUND') info.dnsResolution = 'failed';
    if (error.code === 'EAI_AGAIN') info.dnsResolution = 'temporary_failure';
    
    // Connection errors
    if (error.code === 'ECONNREFUSED') info.connection = 'refused';
    if (error.code === 'ECONNRESET') info.connection = 'reset';
    if (error.code === 'ETIMEDOUT') info.connection = 'timeout';
    if (error.code === 'ECONNABORTED') info.connection = 'aborted';
    
    // TLS/SSL certificate information
    if (error.code === 'CERT_HAS_EXPIRED') info.tlsError = 'certificate_expired';
    if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN') info.tlsError = 'self_signed_certificate';
    if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') info.tlsError = 'certificate_verification_failed';
    if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') info.tlsError = 'self_signed_root_certificate';
    
    return Object.keys(info).length > 0 ? info : undefined;
  }

  /**
   * Get troubleshooting suggestions based on error type
   */
  getTroubleshootingInfo(error) {
    const suggestions = [];
    
    switch (error.code) {
      case 'ENOTFOUND':
        suggestions.push('Check if the hostname is correct');
        suggestions.push('Verify DNS resolution is working');
        break;
      case 'ECONNREFUSED':
        suggestions.push('Check if the server is running');
        suggestions.push('Verify the port number is correct');
        suggestions.push('Check firewall rules');
        break;
      case 'ETIMEDOUT':
        suggestions.push('Check network connectivity');
        suggestions.push('Consider increasing timeout value');
        suggestions.push('Verify server is responding');
        break;
      case 'CERT_HAS_EXPIRED':
        suggestions.push('Update server certificate');
        suggestions.push('Consider using httpsAgent with rejectUnauthorized: false for testing');
        break;
      case 'SELF_SIGNED_CERT_IN_CHAIN':
        suggestions.push('Add certificate to trusted store');
        suggestions.push('Use httpsAgent with custom CA for self-signed certificates');
        break;
    }

    if (error.response?.status === 401) {
      suggestions.push('Check authentication credentials');
      suggestions.push('Verify API token is valid');
    }

    if (error.response?.status === 403) {
      suggestions.push('Check user permissions');
      suggestions.push('Verify API access is enabled');
    }

    if (error.response?.status >= 500) {
      suggestions.push('Server error - check server logs');
      suggestions.push('Consider retry with exponential backoff');
    }

    return suggestions.length > 0 ? suggestions : undefined;
  }

  /**
   * Build full URL from axios config
   */
  buildFullUrl(config) {
    try {
      const baseURL = config.baseURL || '';
      const url = config.url || '';
      const fullUrl = baseURL + url;
      
      if (config.params) {
        const params = new URLSearchParams(config.params);
        return `${fullUrl}?${params.toString()}`;
      }
      
      return fullUrl;
    } catch {
      return config.url || 'unknown';
    }
  }

  /**
   * Extract timing information from response
   */
  extractTimingInfo(response, phase) {
    try {
      return response.request?.connection?.[`${phase}Time`] || 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Truncate large response data for logging
   */
  truncateData(data, maxLength = 1000) {
    try {
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      return str.length > maxLength ? str.substring(0, maxLength) + '...[truncated]' : str;
    } catch {
      return '[unable to serialize]';
    }
  }

  /**
   * Generic log method that can be extended for different logging backends
   */
  log(level, message) {
    switch (level) {
      case 'debug':
        console.debug(message);
        break;
      case 'info':
        console.info(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      case 'error':
        console.error(message);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * Create axios instance with HTTP logging interceptors
   */
  createAxiosInstance(baseConfig = {}) {
    const axios = require('axios');
    const instance = axios.create(baseConfig);
    
    // Request interceptor
    instance.interceptors.request.use(
      (config) => {
        const correlationId = this.generateCorrelationId();
        const startTime = Date.now();
        
        config.metadata = { correlationId, startTime };
        this.logRequest(config, correlationId);
        
        return config;
      },
      (error) => {
        this.log('error', `Request interceptor error: ${error.message}`);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    instance.interceptors.response.use(
      (response) => {
        const { correlationId, startTime } = response.config.metadata || {};
        this.logResponse(response, correlationId, startTime);
        return response;
      },
      (error) => {
        const { correlationId, startTime } = error.config?.metadata || {};
        this.logError(error, correlationId, startTime);
        return Promise.reject(error);
      }
    );

    return instance;
  }

  /**
   * Wrap existing axios instance with logging
   */
  wrapAxiosInstance(axiosInstance) {
    // Request interceptor
    axiosInstance.interceptors.request.use(
      (config) => {
        const correlationId = this.generateCorrelationId();
        const startTime = Date.now();
        
        config.metadata = { correlationId, startTime };
        this.logRequest(config, correlationId);
        
        return config;
      },
      (error) => {
        this.log('error', `Request interceptor error: ${error.message}`);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    axiosInstance.interceptors.response.use(
      (response) => {
        const { correlationId, startTime } = response.config.metadata || {};
        this.logResponse(response, correlationId, startTime);
        return response;
      },
      (error) => {
        const { correlationId, startTime } = error.config?.metadata || {};
        this.logError(error, correlationId, startTime);
        return Promise.reject(error);
      }
    );

    return axiosInstance;
  }
}

module.exports = { HttpLogger };