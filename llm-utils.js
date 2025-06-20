/**
 * LLM Utilities and Best Practices Framework
 * Provides tools for proper LLM interaction patterns including
 * response validation, token management, error handling, and prompt optimization
 */

/**
 * Estimate token count for text content
 * Uses a simple approximation: 1 token ≈ 4 characters
 * More accurate tokenization would require model-specific tokenizers
 */
function estimateTokenCount(text) {
  if (typeof text !== 'string') { return 0; }
  // Rough approximation: 1 token per 4 characters
  // This varies by model and language, but provides a baseline
  return Math.ceil(text.length / 4);
}

/**
 * Token limit configurations for different model types
 */
const TOKEN_LIMITS = {
  'gpt-3.5-turbo': { input: 4096, output: 4096 },
  'gpt-4': { input: 8192, output: 8192 },
  'gpt-4-32k': { input: 32768, output: 32768 },
  'claude-3-sonnet': { input: 200000, output: 4096 },
  'claude-3-opus': { input: 200000, output: 4096 },
  'claude-3-haiku': { input: 200000, output: 4096 },
  default: { input: 4096, output: 1024 }
};

/**
 * Validate and potentially truncate content to fit within token limits
 */
function validateTokenLimits(content, modelType = 'default', reserveOutputTokens = 1024) {
  const limits = TOKEN_LIMITS[modelType] || TOKEN_LIMITS.default;
  const maxInputTokens = limits.input - reserveOutputTokens;

  const estimatedTokens = estimateTokenCount(content);

  if (estimatedTokens <= maxInputTokens) {
    return {
      content,
      withinLimits: true,
      estimatedTokens,
      maxInputTokens
    };
  }

  // Calculate truncation point (leave some buffer)
  const targetChars = Math.floor(maxInputTokens * 4 * 0.9); // 90% of limit for safety
  const truncatedContent = content.substring(0, targetChars) + '...\n[Content truncated to fit token limits]';

  return {
    content: truncatedContent,
    withinLimits: false,
    estimatedTokens: estimateTokenCount(truncatedContent),
    originalTokens: estimatedTokens,
    maxInputTokens,
    truncated: true
  };
}

/**
 * Response validation schemas for different prompt types
 */
const RESPONSE_SCHEMAS = {
  playlist_description: {
    type: 'object',
    required: ['description'],
    properties: {
      description: {
        type: 'string',
        minLength: 50,
        maxLength: 500
      }
    }
  },

  content_recommendation: {
    type: 'object',
    required: ['recommendations'],
    properties: {
      recommendations: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          required: ['title', 'reason'],
          properties: {
            title: { type: 'string', minLength: 1 },
            year: { type: 'number', minimum: 1900, maximum: 2100 },
            reason: { type: 'string', minLength: 20 },
            appeal: { type: 'string' },
            features: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  },

  smart_playlist_rules: {
    type: 'object',
    required: ['criteria'],
    properties: {
      criteria: {
        type: 'object',
        properties: {
          filters: { type: 'array', items: { type: 'object' } },
          sorting: { type: 'object' },
          advanced_criteria: { type: 'array' },
          tips: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  },

  media_analysis: {
    type: 'object',
    required: ['insights'],
    properties: {
      insights: {
        type: 'object',
        properties: {
          patterns: { type: 'array' },
          recommendations: { type: 'array' },
          statistics: { type: 'object' },
          trends: { type: 'array' }
        }
      }
    }
  }
};

/**
 * Validate LLM response against expected schema
 */
function validateResponse(response, promptType) {
  const schema = RESPONSE_SCHEMAS[promptType];
  if (!schema) {
    return {
      valid: true,
      warnings: [`No validation schema defined for prompt type: ${promptType}`]
    };
  }

  const errors = [];
  const warnings = [];

  try {
    // Basic structure validation
    if (typeof response !== 'object' || response === null) {
      errors.push('Response must be a valid object');
      return { valid: false, errors, warnings };
    }

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in response)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Validate specific fields based on prompt type
    switch (promptType) {
      case 'playlist_description':
        if (response.description && response.description.length < 50) {
          warnings.push('Description is quite short, consider expanding');
        }
        break;

      case 'content_recommendation':
        if (response.recommendations && response.recommendations.length === 0) {
          errors.push('At least one recommendation is required');
        }
        break;

      case 'smart_playlist_rules':
        if (response.criteria && !response.criteria.filters) {
          warnings.push('No specific filters provided in criteria');
        }
        break;
    }
  } catch (error) {
    errors.push(`Validation error: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Retry logic with exponential backoff for external API calls
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on certain error types
      if (error.code === 'INVALID_REQUEST' || error.status === 400) {
        throw error;
      }

      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Model parameter configurations for different use cases
 */
const MODEL_PARAMETERS = {
  creative: {
    temperature: 0.8,
    top_p: 0.9,
    frequency_penalty: 0.1,
    presence_penalty: 0.1
  },
  analytical: {
    temperature: 0.3,
    top_p: 0.8,
    frequency_penalty: 0.0,
    presence_penalty: 0.0
  },
  balanced: {
    temperature: 0.6,
    top_p: 0.85,
    frequency_penalty: 0.05,
    presence_penalty: 0.05
  },
  conservative: {
    temperature: 0.1,
    top_p: 0.7,
    frequency_penalty: 0.0,
    presence_penalty: 0.0
  }
};

/**
 * Get recommended model parameters for a prompt type
 */
function getModelParameters(promptType, style = 'balanced') {
  const baseParams = MODEL_PARAMETERS[style] || MODEL_PARAMETERS.balanced;

  // Adjust parameters based on prompt type
  switch (promptType) {
    case 'playlist_description':
      return { ...baseParams, temperature: 0.8 }; // More creative

    case 'content_recommendation':
      return { ...baseParams, temperature: 0.6 }; // Balanced

    case 'smart_playlist_rules':
      return { ...baseParams, temperature: 0.3 }; // More analytical

    case 'media_analysis':
      return { ...baseParams, temperature: 0.2 }; // Very analytical

    default:
      return baseParams;
  }
}

/**
 * Enhanced prompt builder with context inclusion and validation
 */
function buildEnhancedPrompt(promptType, args, context = {}) {
  const errors = [];

  // Validate required arguments based on prompt type
  switch (promptType) {
    case 'playlist_description':
      if (!args.playlist_name) { errors.push('playlist_name is required'); }
      break;
    case 'content_recommendation':
      if (!args.liked_content) { errors.push('liked_content is required'); }
      break;
    case 'smart_playlist_rules':
      if (!args.intent) { errors.push('intent is required'); }
      break;
    case 'media_analysis':
      if (!args.content_data) { errors.push('content_data is required'); }
      break;
  }

  if (errors.length > 0) {
    throw new Error(`Prompt validation failed: ${errors.join(', ')}`);
  }

  // Include relevant context
  const contextInfo = [];
  if (context.userLibrarySize) {
    contextInfo.push(`User has ${context.userLibrarySize} items in their library`);
  }
  if (context.preferredGenres) {
    contextInfo.push(`Preferred genres: ${context.preferredGenres.join(', ')}`);
  }
  if (context.recentActivity) {
    contextInfo.push(`Recent activity: ${context.recentActivity}`);
  }

  const contextString = contextInfo.length > 0 ?
    `\n\nContext: ${contextInfo.join('. ')}\n` :
    '';

  return {
    promptType,
    args,
    context: contextString,
    modelParameters: getModelParameters(promptType),
    tokenValidation: validateTokenLimits(JSON.stringify(args) + contextString)
  };
}

/**
 * Error handling patterns for LLM interactions
 */
function handleLLMError(error, promptType) {
  const baseMessage = `Error in ${promptType} prompt`;

  if (error.code === 'rate_limit_exceeded') {
    return {
      error: 'Rate limit exceeded',
      message: `${baseMessage}: Too many requests. Please try again later.`,
      retryable: true,
      retryAfter: error.retry_after || 60
    };
  }

  if (error.code === 'insufficient_quota') {
    return {
      error: 'Quota exceeded',
      message: `${baseMessage}: API quota exceeded. Check your billing.`,
      retryable: false
    };
  }

  if (error.code === 'model_overloaded') {
    return {
      error: 'Model overloaded',
      message: `${baseMessage}: Model is overloaded. Try again shortly.`,
      retryable: true,
      retryAfter: 30
    };
  }

  if (error.code === 'invalid_request_error') {
    return {
      error: 'Invalid request',
      message: `${baseMessage}: Request format is invalid. Check prompt structure.`,
      retryable: false
    };
  }

  return {
    error: 'Unknown error',
    message: `${baseMessage}: ${error.message}`,
    retryable: true
  };
}

module.exports = {
  estimateTokenCount,
  validateTokenLimits,
  validateResponse,
  retryWithBackoff,
  getModelParameters,
  buildEnhancedPrompt,
  handleLLMError,
  TOKEN_LIMITS,
  MODEL_PARAMETERS,
  RESPONSE_SCHEMAS
};
