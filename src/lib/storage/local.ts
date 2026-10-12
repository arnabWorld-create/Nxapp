import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage } from './types';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function localPath(key: string): string {
  const fileName = path.basename(key);
  if (!fileName || fileName !== key.split('/').pop()) {
    throw new Error('Invalid storage key');
  }
  return path.join(UPLOAD_DIR, fileName);
}

export function createLocalFileStorage(): FileStorage {
  return {
    async put({ key, body }) {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.writeFile(localPath(key), body);
    },
    async get(key) {
      return fs.readFile(localPath(key));
    },
    async delete(key) {
      await fs.unlink(localPath(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
    async exists(key) {
      try {
        await fs.access(localPath(key));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
  };
}