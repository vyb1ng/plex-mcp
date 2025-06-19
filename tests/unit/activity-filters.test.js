const PlexMCPServer = require('../../index.js');

describe('Activity Filters', () => {
  let server;

  beforeEach(() => {
    server = new PlexMCPServer({ axios: require('axios').create() });
  });

  describe('applyActivityFilters', () => {
    const mockResults = [
      {
        title: 'Never Played Track',
        viewCount: 0,
        lastViewedAt: null
      },
      {
        title: 'Rarely Played Track',
        viewCount: 2,
        lastViewedAt: 1703097600 // 2023-12-20
      },
      {
        title: 'Popular Track',
        viewCount: 15,
        lastViewedAt: 1703270400 // 2023-12-22
      },
      {
        title: 'Recent Hit',
        viewCount: 8,
        lastViewedAt: Math.floor(Date.now() / 1000) - (2 * 24 * 60 * 60) // 2 days ago
      }
    ];

    it('should filter by minimum play count', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        play_count_min: 5
      });

      expect(filtered).toHaveLength(2);
      expect(filtered[0].title).toBe('Popular Track');
      expect(filtered[1].title).toBe('Recent Hit');
    });

    it('should filter by maximum play count', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        play_count_max: 10
      });

      expect(filtered).toHaveLength(3);
      expect(filtered.map(r => r.title)).toEqual([
        'Never Played Track',
        'Rarely Played Track', 
        'Recent Hit'
      ]);
    });

    it('should filter by play count range', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        play_count_min: 2,
        play_count_max: 10
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual([
        'Rarely Played Track',
        'Recent Hit'
      ]);
    });

    it('should filter never played items', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        never_played: true
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Never Played Track');
    });

    it('should filter by last played after date', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        last_played_after: '2023-12-21'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual([
        'Popular Track',
        'Recent Hit'
      ]);
    });

    it('should filter by last played before date', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        last_played_before: '2023-12-21'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Rarely Played Track');
    });

    it('should filter by played in last days', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        played_in_last_days: 5
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Recent Hit');
    });

    it('should exclude unplayed items when filtering by dates', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        last_played_after: '2023-01-01'
      });

      // Should exclude 'Never Played Track' even though it matches other criteria
      expect(filtered).toHaveLength(3);
      expect(filtered.map(r => r.title)).not.toContain('Never Played Track');
    });

    it('should handle items without viewCount property', () => {
      const resultsWithoutViewCount = [
        { title: 'Track Without ViewCount' },
        { title: 'Track With ViewCount', viewCount: 5 }
      ];

      const filtered = server.applyActivityFilters(resultsWithoutViewCount, {
        play_count_min: 1
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Track With ViewCount');
    });

    it('should handle multiple filters combined', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        play_count_min: 5,
        last_played_after: '2023-12-21'
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.title)).toEqual([
        'Popular Track',
        'Recent Hit'
      ]);
    });

    it('should return all items when no filters applied', () => {
      const filtered = server.applyActivityFilters(mockResults, {});

      expect(filtered).toHaveLength(4);
      expect(filtered).toEqual(mockResults);
    });

    it('should handle edge case with zero play count filter', () => {
      const filtered = server.applyActivityFilters(mockResults, {
        play_count_max: 0
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Never Played Track');
    });
  });
});