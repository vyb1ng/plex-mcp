const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    ignores: [
      'node_modules/',
      'coverage/',
      '*.min.js',
      'dist/',
      'build/',
      '.git/'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URLSearchParams: 'readonly'
      }
    },
    rules: {
      // Error prevention
      'no-console': 'off', // We need console for this CLI tool
      'no-unused-vars': ['warn', { // Changed to warn instead of error
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'error',
      'no-func-assign': 'error',
      'no-inner-declarations': 'error',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': 'error',
      'no-obj-calls': 'error',
      'no-regex-spaces': 'error',
      'no-sparse-arrays': 'error',
      'no-unexpected-multiline': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // Best practices
      curly: ['error', 'all'],
      'dot-notation': 'error',
      eqeqeq: ['error', 'always'],
      'no-alert': 'error',
      'no-caller': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-fallthrough': 'error',
      'no-case-declarations': 'off', // Allow declarations in case blocks
      'no-floating-decimal': 'error',
      'no-implied-eval': 'error',
      'no-lone-blocks': 'error',
      'no-loop-func': 'error',
      'no-multi-spaces': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-octal': 'error',
      'no-octal-escape': 'error',
      'no-redeclare': 'error',
      'no-return-assign': 'error',
      'no-script-url': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-void': 'error',
      radix: 'error',
      'wrap-iife': ['error', 'any'],
      yoda: 'error',

      // Variables
      'no-delete-var': 'error',
      'no-label-var': 'error',
      'no-restricted-globals': 'error',
      'no-shadow': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef-init': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],

      // Style
      'array-bracket-spacing': ['error', 'never'],
      'block-spacing': 'error',
      'brace-style': ['warn', '1tbs', { allowSingleLine: true }], // Changed to warn
      camelcase: ['error', { properties: 'never', allow: [
        'play_count_min', 'play_count_max', 'last_played_after', 'last_played_before',
        'played_in_last_days', 'never_played', 'content_rating', 'audio_format',
        'bpm_min', 'bmp_max', 'musical_key', 'dynamic_range_min', 'dynamic_range_max',
        'loudness_min', 'loudness_max', 'acoustic_ratio_min', 'acoustic_ratio_max',
        'file_size_min', 'file_size_max', 'year_min', 'year_max', 'rating_min',
        'rating_max', 'duration_min', 'duration_max', 'added_after', 'added_before',
        'library_id', 'chunk_size', 'chunk_offset', 'time_period', 'music_library_id',
        'include_recommendations', 'include_details', 'account_id', 'playlist_type',
        'playlist_id', 'item_key', 'item_keys', 'collection_id', 'pin_id'
      ] }],
      'comma-dangle': ['error', 'never'],
      'comma-spacing': ['error', { before: false, after: true }],
      'comma-style': ['error', 'last'],
      'computed-property-spacing': ['error', 'never'],
      'eol-last': 'error',
      'func-call-spacing': ['error', 'never'],
      indent: ['error', 2, { SwitchCase: 1 }],
      'key-spacing': ['error', { beforeColon: false, afterColon: true }],
      'keyword-spacing': ['error', { before: true, after: true }],
      'linebreak-style': ['error', 'unix'],
      'max-len': ['error', {
        code: 150, // Increased for this complex codebase
        tabWidth: 2,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreComments: true
      }],
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],
      'new-parens': 'error',
      'no-array-constructor': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
      'no-new-object': 'error',
      'no-spaced-func': 'error',
      'no-trailing-spaces': 'error',
      'no-unneeded-ternary': 'error',
      'object-curly-spacing': ['error', 'always'],
      'one-var': ['error', 'never'],
      'operator-assignment': ['error', 'always'],
      'operator-linebreak': ['error', 'after'],
      'padded-blocks': ['error', 'never'],
      'quote-props': ['error', 'as-needed'],
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      'semi-spacing': ['error', { before: false, after: true }],
      'space-before-blocks': 'error',
      'space-before-function-paren': ['error', 'never'],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      'space-unary-ops': ['error', { words: true, nonwords: false }],
      'spaced-comment': ['error', 'always']
    }
  },
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly'
      }
    },
    rules: {
      'no-unused-expressions': 'off', // Allow expect().toBe() etc
      'max-len': ['error', { code: 999 }] // Longer lines allowed in tests
    }
  }
];

