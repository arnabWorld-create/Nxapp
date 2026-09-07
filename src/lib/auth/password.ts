import crypto from 'crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCKSIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCKSIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [scheme, salt, keyHex] = storedHash.split('$');
    if (scheme !== 'scrypt' || !salt || !keyHex) {
      return false;
    }
    const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
      cost: SCRYPT_COST,
      blockSize: SCRYPT_BLOCKSIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      maxmem: 64 * 1024 * 1024,
    });
    const keyBuffer = Buffer.from(keyHex, 'hex');
    return crypto.timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}