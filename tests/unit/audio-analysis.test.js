const PlexMCPServer = require('../../index.js');

describe('Audio Analysis Features', () => {
  let server;

  beforeEach(() => {
    server = new PlexMCPServer({ axios: require('axios').create() });
  });

  describe('calculateAudioQuality', () => {
    it('should calculate quality for high-end FLAC', () => {
      const media = {
        bitrate: 1411,
        audioCodec: 'flac',
        audioChannels: 2,
        dynamicRange: 20
      };

      const quality = server.calculateAudioQuality(media);

      expect(quality.score).toBe(85); // 30 + 25 + 10 + 20
      expect(quality.rating).toBe('Excellent');
      expect(quality.factors).toContain('High bitrate');
      expect(quality.factors).toContain('Lossless codec');
      expect(quality.factors).toContain('Excellent dynamic range');
    });

    it('should calculate quality for standard MP3', () => {
      const media = {
        bitrate: 320,
        audioCodec: 'mp3',
        audioChannels: 2
      };

      const quality = server.calculateAudioQuality(media);

      expect(quality.score).toBe(30); // 10 + 10 + 10
      expect(quality.rating).toBe('Poor');
      expect(quality.factors).toContain('Decent bitrate');
      expect(quality.factors).toContain('Standard codec');
      expect(quality.factors).toContain('Stereo');
    });

    it('should calculate quality for surround sound', () => {
      const media = {
        bitrate: 1500,
        audioCodec: 'truehd',
        audioChannels: 8
      };

      const quality = server.calculateAudioQuality(media);

      expect(quality.score).toBe(70); // 30 + 25 + 15
      expect(quality.rating).toBe('Good');
      expect(quality.factors).toContain('Surround sound');
    });

    it('should handle null media input', () => {
      const quality = server.calculateAudioQuality(null);
      expect(quality).toBeNull();
    });
  });

  describe('BPM estimation from genre', () => {
    it('should estimate BPM for electronic genres', () => {
      expect(server.estimateBPMFromGenre('Drum and Bass')).toBe(170);
      expect(server.estimateBPMFromGenre('Techno')).toBe(130);
      expect(server.estimateBPMFromGenre('House')).toBe(125);
    });

    it('should estimate BPM for traditional genres', () => {
      expect(server.estimateBPMFromGenre('Pop')).toBe(120);
      expect(server.estimateBPMFromGenre('Hip Hop')).toBe(95);
      expect(server.estimateBPMFromGenre('Folk')).toBe(80);
      expect(server.estimateBPMFromGenre('Ballad')).toBe(70);
    });

    it('should return null for unknown genres', () => {
      expect(server.estimateBPMFromGenre('Unknown Genre')).toBeNull();
      expect(server.estimateBPMFromGenre(null)).toBeNull();
    });
  });

  describe('Mood estimation from genre', () => {
    it('should classify energetic genres', () => {
      expect(server.estimateMoodFromGenre('Dance')).toBe('energetic');
      expect(server.estimateMoodFromGenre('Electronic')).toBe('energetic');
      expect(server.estimateMoodFromGenre('Pop')).toBe('energetic');
    });

    it('should classify calm genres', () => {
      expect(server.estimateMoodFromGenre('Ambient')).toBe('calm');
      expect(server.estimateMoodFromGenre('Classical')).toBe('calm');
      expect(server.estimateMoodFromGenre('Folk')).toBe('calm');
    });

    it('should classify aggressive genres', () => {
      expect(server.estimateMoodFromGenre('Rock')).toBe('aggressive');
      expect(server.estimateMoodFromGenre('Metal')).toBe('aggressive');
    });

    it('should classify melancholic genres', () => {
      expect(server.estimateMoodFromGenre('Jazz')).toBe('melancholic');
      expect(server.estimateMoodFromGenre('Blues')).toBe('melancholic');
    });

    it('should return null for unknown genres', () => {
      expect(server.estimateMoodFromGenre('Unknown')).toBeNull();
      expect(server.estimateMoodFromGenre(null)).toBeNull();
    });
  });

  describe('Acoustic ratio estimation from genre', () => {
    it('should classify highly acoustic genres', () => {
      expect(server.estimateAcousticRatioFromGenre('Acoustic')).toBe(0.9);
      expect(server.estimateAcousticRatioFromGenre('Folk')).toBe(0.9);
      expect(server.estimateAcousticRatioFromGenre('Country')).toBe(0.9);
    });

    it('should classify mostly acoustic genres', () => {
      expect(server.estimateAcousticRatioFromGenre('Classical')).toBe(0.8);
      expect(server.estimateAcousticRatioFromGenre('Jazz')).toBe(0.8);
    });

    it('should classify mixed genres', () => {
      expect(server.estimateAcousticRatioFromGenre('Rock')).toBe(0.5);
      expect(server.estimateAcousticRatioFromGenre('Pop')).toBe(0.5);
    });

    it('should classify electronic genres', () => {
      expect(server.estimateAcousticRatioFromGenre('Electronic')).toBe(0.1);
      expect(server.estimateAcousticRatioFromGenre('Synth')).toBe(0.1);
      expect(server.estimateAcousticRatioFromGenre('Techno')).toBe(0.1);
    });

    it('should return null for unknown genres', () => {
      expect(server.estimateAcousticRatioFromGenre('Unknown')).toBeNull();
      expect(server.estimateAcousticRatioFromGenre(null)).toBeNull();
    });
  });

  describe('searchByAudioAnalysis', () => {
    const mockLibraries = [
      { key: '1', title: 'Music', type: 'artist' }
    ];

    const mockResponse = {
      data: {
        MediaContainer: {
          Metadata: [
            {
              title: 'Electronic Track',
              grandparentTitle: 'Artist 1',
              parentTitle: 'Album 1',
              genre: 'Electronic Dance'
            },
            {
              title: 'Acoustic Song',
              grandparentTitle: 'Artist 2',
              parentTitle: 'Album 2',
              genre: 'Folk Acoustic'
            },
            {
              title: 'Rock Anthem',
              grandparentTitle: 'Artist 3',
              parentTitle: 'Album 3',
              genre: 'Rock'
            }
          ]
        }
      }
    };

    beforeEach(() => {
      server.axios = {
        get: jest.fn().mockResolvedValue(mockResponse)
      };
      server.parseLibraryContent = jest.fn().mockReturnValue(mockResponse.data.MediaContainer.Metadata);
      server.getHttpsAgent = jest.fn().mockReturnValue(null);
    });

    it('should search for energetic tracks', async() => {
      const results = await server.searchByAudioAnalysis(
        'energetic dance music',
        mockLibraries,
        'http://localhost:32400',
        'token123',
        10
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].reason).toContain('Energetic track');
      // The first result could be either electronic (energetic) or rock (aggressive)
      // depending on array ordering, so we check for results containing energetic tracks
      const energeticTrack = results.find(r => r.estimatedMood === 'energetic');
      expect(energeticTrack).toBeDefined();
    });

    it('should search for acoustic tracks', async() => {
      const results = await server.searchByAudioAnalysis(
        'acoustic songs',
        mockLibraries,
        'http://localhost:32400',
        'token123',
        10
      );

      expect(results.length).toBeGreaterThan(0);
      const acousticTrack = results.find(r => r.title === 'Acoustic Song');
      expect(acousticTrack).toBeDefined();
      expect(acousticTrack.reason).toContain('Acoustic track');
      expect(acousticTrack.estimatedAcousticRatio).toBe(0.9);
    });

    it('should search for electronic tracks', async() => {
      const results = await server.searchByAudioAnalysis(
        'electronic music',
        mockLibraries,
        'http://localhost:32400',
        'token123',
        10
      );

      expect(results.length).toBeGreaterThan(0);
      const electronicTrack = results.find(r => r.title === 'Electronic Track');
      expect(electronicTrack).toBeDefined();
      expect(electronicTrack.reason).toContain('Electronic track');
      expect(electronicTrack.estimatedAcousticRatio).toBe(0.1);
    });

    it('should handle API errors gracefully', async() => {
      server.axios.get = jest.fn().mockRejectedValue(new Error('API Error'));

      const results = await server.searchByAudioAnalysis(
        'energetic music',
        mockLibraries,
        'http://localhost:32400',
        'token123',
        10
      );

      expect(results).toEqual([]);
    });
  });
});
