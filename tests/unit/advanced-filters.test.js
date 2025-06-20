const PlexMCPServer = require('../../index.js');

describe('Advanced Filters', () => {
  let server;

  beforeEach(() => {
    server = new PlexMCPServer({ axios: require('axios').create() });
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

    // Audio Analysis Filter Tests
    describe('Audio Analysis Filters', () => {
      const mockMusicTracks = [
        {
          title: 'Energetic Dance Track',
          genre: 'Electronic Dance',
          tempo: 128,
          mood: 'energetic',
          acousticRatio: 0.2,
          dynamicRange: 12,
          loudness: -8,
          key: 'Am',
          Media: [{ audioCodec: 'flac', bitrate: 1411 }]
        },
        {
          title: 'Calm Acoustic Song',
          genre: 'Folk Acoustic',
          tempo: 75,
          mood: 'calm',
          acousticRatio: 0.9,
          dynamicRange: 18,
          loudness: -12,
          key: 'C',
          Media: [{ audioCodec: 'flac', bitrate: 1411 }]
        },
        {
          title: 'Fast Rock Track',
          genre: 'Rock',
          tempo: 160,
          mood: 'aggressive',
          acousticRatio: 0.4,
          dynamicRange: 15,
          loudness: -6,
          key: 'Em',
          Media: [{ audioCodec: 'mp3', bitrate: 320 }]
        }
      ];

      it('should filter by BPM range', () => {
        const slowTracks = server.applyAdvancedFilters(mockMusicTracks, {
          bpm_max: 100
        });
        expect(slowTracks).toHaveLength(1);
        expect(slowTracks[0].title).toBe('Calm Acoustic Song');

        const fastTracks = server.applyAdvancedFilters(mockMusicTracks, {
          bpm_min: 120
        });
        expect(fastTracks).toHaveLength(2);
        expect(fastTracks.map(t => t.title)).toContain('Energetic Dance Track');
        expect(fastTracks.map(t => t.title)).toContain('Fast Rock Track');
      });

      it('should filter by musical key', () => {
        const cKeyTracks = server.applyAdvancedFilters(mockMusicTracks, {
          musical_key: 'C'
        });
        expect(cKeyTracks).toHaveLength(1);
        expect(cKeyTracks[0].title).toBe('Calm Acoustic Song');
      });

      it('should filter by mood', () => {
        const energeticTracks = server.applyAdvancedFilters(mockMusicTracks, {
          mood: 'energetic'
        });
        expect(energeticTracks).toHaveLength(1);
        expect(energeticTracks[0].title).toBe('Energetic Dance Track');

        const calmTracks = server.applyAdvancedFilters(mockMusicTracks, {
          mood: 'calm'
        });
        expect(calmTracks).toHaveLength(1);
        expect(calmTracks[0].title).toBe('Calm Acoustic Song');
      });

      it('should filter by acoustic ratio', () => {
        const acousticTracks = server.applyAdvancedFilters(mockMusicTracks, {
          acoustic_ratio_min: 0.8
        });
        expect(acousticTracks).toHaveLength(1);
        expect(acousticTracks[0].title).toBe('Calm Acoustic Song');

        const electronicTracks = server.applyAdvancedFilters(mockMusicTracks, {
          acoustic_ratio_max: 0.3
        });
        expect(electronicTracks).toHaveLength(1);
        expect(electronicTracks[0].title).toBe('Energetic Dance Track');
      });

      it('should filter by dynamic range', () => {
        const highDRTracks = server.applyAdvancedFilters(mockMusicTracks, {
          dynamic_range_min: 16
        });
        expect(highDRTracks).toHaveLength(1);
        expect(highDRTracks[0].title).toBe('Calm Acoustic Song');
      });

      it('should filter by loudness (LUFS)', () => {
        const loudTracks = server.applyAdvancedFilters(mockMusicTracks, {
          loudness_max: -10
        });
        expect(loudTracks).toHaveLength(1);
        expect(loudTracks[0].title).toBe('Calm Acoustic Song');
      });

      it('should handle combined audio analysis filters', () => {
        const filtered = server.applyAdvancedFilters(mockMusicTracks, {
          bpm_min: 120,
          mood: 'energetic',
          acoustic_ratio_max: 0.5
        });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].title).toBe('Energetic Dance Track');
      });

      it('should return all tracks when audio analysis data is missing', () => {
        // Test that filters don't exclude tracks when analysis data is unavailable
        // (current placeholder implementation)
        const tracksWithoutAnalysis = [
          {
            title: 'Track Without Analysis',
            Media: [{ audioCodec: 'mp3' }]
          }
        ];

        const filtered = server.applyAdvancedFilters(tracksWithoutAnalysis, {
          bpm_min: 120,
          mood: 'energetic'
        });
        expect(filtered).toHaveLength(1);
      });
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
