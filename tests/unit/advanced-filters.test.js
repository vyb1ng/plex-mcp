const PlexMCPServer = require('../../index.js');

describe('Advanced Filters', () => {
  let server;

  beforeEach(() => {
    server = new PlexMCPServer();
  });

  describe('applyAdvancedFilters', () => {
    const mockResults = [
      {
        title: 'R-Rated Movie',
        contentRating: 'R',
        Media: [
          {
            videoResolution: '1080',
            height: 1080,
            Part: [
              {
                audioCodec: 'aac',
                size: 2147483648 // 2GB
              }
            ]
          }
        ]
      },
      {
        title: 'PG Movie',
        contentRating: 'PG',
        Media: [
          {
            videoResolution: '4k',
            height: 2160,
            Part: [
              {
                audioCodec: 'truehd',
                size: 5368709120 // 5GB
              }
            ]
          }
        ]
      },
      {
        title: 'FLAC Music Track',
        contentRating: 'G',
        Media: [
          {
            Part: [
              {
                audioCodec: 'flac',
                size: 52428800 // 50MB
              }
            ]
          }
        ]
      },
      {
        title: 'Basic SD Movie',
        contentRating: 'PG-13',
        Media: [
          {
            videoResolution: '480',
            height: 480,
            Part: [
              {
                audioCodec: 'mp3',
                size: 1073741824 // 1GB
              }
            ]
          }
        ]
      }
    ];

    it('should filter by content rating', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        content_rating: 'R'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('R-Rated Movie');
    });

    it('should filter by 4K resolution', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        resolution: '4k'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('PG Movie');
    });

    it('should filter by 1080p resolution', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        resolution: '1080'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['R-Rated Movie', 'PG Movie']);
    });

    it('should filter by 720p resolution (includes higher)', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        resolution: '720'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['R-Rated Movie', 'PG Movie']);
    });

    it('should filter by SD resolution', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        resolution: 'sd'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Basic SD Movie');
    });

    it('should filter by lossless audio format', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        audio_format: 'lossless'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['PG Movie', 'FLAC Music Track']);
    });

    it('should filter by lossy audio format', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        audio_format: 'lossy'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['R-Rated Movie', 'Basic SD Movie']);
    });

    it('should filter by specific audio format (FLAC)', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        audio_format: 'flac'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('FLAC Music Track');
    });

    it('should filter by specific audio format (MP3)', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        audio_format: 'mp3'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Basic SD Movie');
    });

    it('should filter by minimum file size', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        file_size_min: 2000 // 2GB
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['R-Rated Movie', 'PG Movie']);
    });

    it('should filter by maximum file size', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        file_size_max: 100 // 100MB
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('FLAC Music Track');
    });

    it('should filter by file size range', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        file_size_min: 500, // 500MB
        file_size_max: 3000 // 3GB
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['R-Rated Movie', 'Basic SD Movie']);
    });

    it('should handle multiple advanced filters combined', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        content_rating: 'PG',
        resolution: '4k',
        audio_format: 'lossless'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('PG Movie');
    });

    it('should return empty array when no items match filters', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {
        content_rating: 'NC-17'
      });

      expect(filtered).toHaveLength(0);
    });

    it('should return all items when no filters applied', () => {
      const filtered = server.applyAdvancedFilters(mockResults, {});

      expect(filtered).toHaveLength(4);
      expect(filtered).toEqual(mockResults);
    });

    it('should handle items without Media array', () => {
      const resultsWithoutMedia = [
        {
          title: 'Item Without Media',
          contentRating: 'G'
        },
        ...mockResults
      ];

      // When filtering by resolution, items without Media are excluded  
      const resolutionFiltered = server.applyAdvancedFilters(resultsWithoutMedia, {
        resolution: '1080'
      });

      expect(resolutionFiltered).toHaveLength(2);
      expect(resolutionFiltered.map(r => r.title)).toEqual(['R-Rated Movie', 'PG Movie']);

      // When filtering by content rating only, items without Media are included
      const ratingFiltered = server.applyAdvancedFilters(resultsWithoutMedia, {
        content_rating: 'G'
      });

      expect(ratingFiltered).toHaveLength(2);
      expect(ratingFiltered.map(r => r.title)).toEqual(['Item Without Media', 'FLAC Music Track']);
    });

    it('should handle items without contentRating', () => {
      const resultsWithoutRating = [
        {
          title: 'Item Without Rating',
          Media: mockResults[0].Media
        },
        ...mockResults
      ];

      const filtered = server.applyAdvancedFilters(resultsWithoutRating, {
        content_rating: 'R'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('R-Rated Movie');
    });

    it('should handle edge case with exact resolution match', () => {
      const resultsWithExactHeight = [
        {
          title: 'Exactly 720p',
          Media: [
            {
              height: 720,
              Part: [{ audioCodec: 'aac', size: 1000000000 }]
            }
          ]
        }
      ];

      const filtered = server.applyAdvancedFilters(resultsWithExactHeight, {
        resolution: '720'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Exactly 720p');
    });

    it('should handle audio codec case insensitivity', () => {
      const resultsWithMixedCase = [
        {
          title: 'Mixed Case Codec',
          Media: [
            {
              Part: [
                {
                  audioCodec: 'FLAC',
                  size: 50000000
                }
              ]
            }
          ]
        }
      ];

      const filtered = server.applyAdvancedFilters(resultsWithMixedCase, {
        audio_format: 'flac'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Mixed Case Codec');
    });

    it('should handle multiple Parts in Media array', () => {
      const resultsWithMultipleParts = [
        {
          title: 'Multi-Part Item',
          Media: [
            {
              Part: [
                { audioCodec: 'aac', size: 500000000 },
                { audioCodec: 'flac', size: 300000000 }
              ]
            }
          ]
        }
      ];

      // Should match because one part has FLAC
      const flacFiltered = server.applyAdvancedFilters(resultsWithMultipleParts, {
        audio_format: 'flac'
      });

      expect(flacFiltered).toHaveLength(1);

      // Should also match lossless filter
      const losslessFiltered = server.applyAdvancedFilters(resultsWithMultipleParts, {
        audio_format: 'lossless'
      });

      expect(losslessFiltered).toHaveLength(1);

      // Total file size should be sum of parts (800MB)
      const sizeFiltered = server.applyAdvancedFilters(resultsWithMultipleParts, {
        file_size_min: 700,
        file_size_max: 900
      });

      expect(sizeFiltered).toHaveLength(1);
    });

    it('should handle DTS and TrueHD as lossless formats', () => {
      const resultsWithDTS = [
        {
          title: 'DTS Movie',
          Media: [
            {
              Part: [{ audioCodec: 'dts', size: 1000000000 }]
            }
          ]
        },
        {
          title: 'TrueHD Movie',
          Media: [
            {
              Part: [{ audioCodec: 'truehd', size: 1000000000 }]
            }
          ]
        }
      ];

      const filtered = server.applyAdvancedFilters(resultsWithDTS, {
        audio_format: 'lossless'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['DTS Movie', 'TrueHD Movie']);
    });

    it('should handle AC3 and OGG as lossy formats', () => {
      const resultsWithLossy = [
        {
          title: 'AC3 Movie',
          Media: [
            {
              Part: [{ audioCodec: 'ac3', size: 1000000000 }]
            }
          ]
        },
        {
          title: 'OGG Track',
          Media: [
            {
              Part: [{ audioCodec: 'ogg', size: 50000000 }]
            }
          ]
        }
      ];

      const filtered = server.applyAdvancedFilters(resultsWithLossy, {
        audio_format: 'lossy'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual(['AC3 Movie', 'OGG Track']);
    });
  });
});