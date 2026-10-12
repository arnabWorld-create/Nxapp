import { createLocalFileStorage } from './local';
import { createSupabaseFileStorage } from './supabase';
import type { FileStorage } from './types';

export function createFileStorage(env: NodeJS.ProcessEnv = process.env): FileStorage {
  const provider = env.STORAGE_PROVIDER;

  if (provider === 'local') return createLocalFileStorage();
  if (provider === 'supabase') return createSupabaseFileStorage(env);
  if (env.NODE_ENV === 'test') return createLocalFileStorage();

  throw new Error('STORAGE_PROVIDER must be explicitly set to local or supabase');
}

export const storage: FileStorage = {
  async put(input) {
    return createFileStorage().put(input);
  },
  async get(key) {
    return createFileStorage().get(key);
  },
  async delete(key) {
    return createFileStorage().delete(key);
  },
  async exists(key) {
    return createFileStorage().exists(key);
  },
};
export type { FileStorage } from './types';