import crypto from 'crypto';

const SESSION_TOKEN_LENGTH = 48;
const SESSION_COOKIE_NAME = 'nxapp_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionData {
  token: string;
  userId: string;
  expiresAt: Date;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(SESSION_TOKEN_LENGTH).toString('hex');
}

export const SESSION_CONFIG = {
  cookieName: SESSION_COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
};

export function computeSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}