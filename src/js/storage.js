// storage: OPFS/IndexedDB 抽象層（空実装）
export const storage = {
  async saveFile(/* name: string, blob: Blob */){ throw new Error('not-implemented'); },
  async listFiles(){ return []; },
  async getFile(/* name: string */){ return null; },
  async rename(/* oldName: string, newName: string */){ return false; },
  async remove(/* name: string */){ return false; },
};

