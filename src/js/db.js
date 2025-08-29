// db: メタデータ層（空実装）
export const db = {
  async init(){ /* no-op */ },
  async addTrack(/* track */){ /* no-op */ },
  async updateTrack(/* id, patch */){ /* no-op */ },
  async listTracks(){ return []; },
  async removeTrack(/* id */){ /* no-op */ },
  async getSettings(){ return { playbackRate: 1.0, sortKey: 'addedAt', sortDir: 'desc' }; },
  async setSettings(/* settings */){ /* no-op */ },
  async getPlayStats(/* trackId */){ return { playCount: 0, lastPlayedAt: 0, lastPositionMs: 0 }; },
  async setPlayStats(/* trackId, stats */){ /* no-op */ },
};

