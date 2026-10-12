import { createClient } from '@supabase/supabase-js';
import type { FileStorage } from './types';

export function createSupabaseFileStorage(
  env: NodeJS.ProcessEnv = process.env,
  clientOverride?: ReturnType<typeof createClient>,
): FileStorage {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET;

  if (!url || !serviceRoleKey || !bucket) {
    throw new Error('Supabase storage requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET');
  }

  const client = clientOverride ?? createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  return {
    async put({ key, body, contentType }) {
      const { error } = await client.storage.from(bucket).upload(key, body, { contentType, upsert: true });
      if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await client.storage.from(bucket).download(key);
      if (error || !data) throw new Error(`Supabase storage download failed: ${error?.message ?? 'file not found'}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async delete(key) {
      const { error } = await client.storage.from(bucket).remove([key]);
      if (error) throw new Error(`Supabase storage delete failed: ${error.message}`);
    },
    async exists(key) {
      const directory = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
      const fileName = key.slice(key.lastIndexOf('/') + 1);
      const { data, error } = await client.storage.from(bucket).list(directory, { search: fileName, limit: 100 });
      if (error) throw new Error(`Supabase storage existence check failed: ${error.message}`);
      return data.some((file) => file.name === fileName);
    },
  };
}