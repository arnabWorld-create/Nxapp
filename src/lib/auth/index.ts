import { cookies } from 'next/headers';
import prisma from '../prisma';
import { getUserById, userHasPermission } from '../import/upload';
import { verifyPassword } from './password';
import {
  generateSessionToken,
  computeSessionExpiry,
  SESSION_CONFIG,
} from './session';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role_id: string;
  role: {
    id: string;
    name: string;
    role_permissions: Array<{ permission: { name: string } }>;
  };
}

export function isLegacyXUserIdAllowed(): boolean {
  const explicitValue = process.env.ALLOW_LEGACY_X_USER_ID;
  if (explicitValue !== undefined) {
    return explicitValue === 'true';
  }

  return process.env.NODE_ENV === 'test' || !process.env.NODE_ENV;
}

/**
 * Authenticate a user by email + password. Returns the user (without password
 * hash) if valid, or null otherwise. Also rejects INACTIVE users.
 */
export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: {
      role: {
        include: {
          role_permissions: { include: { permission: true } },
        },
      },
    },
  });

  if (!user) return null;
  if (user.status !== 'ACTIVE') return null;

  const ok = verifyPassword(password, user.password_hash);
  if (!ok) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
    role: {
      id: user.role.id,
      name: user.role.name,
      role_permissions: user.role.role_permissions.map((rp) => ({
        permission: { name: rp.permission.name },
      })),
    },
  };
}

/**
 * Create a persisted session row and return the token.
 */
export async function createSession(userId: string): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = computeSessionExpiry();

  await prisma.session.create({
    data: { token, user_id: userId, expires_at: expiresAt },
  });

  return token;
}

/**
 * Delete a session by token (logout).
 */
export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

/**
 * Resolve the current user from the session cookie. Returns null if no valid
 * session exists. Expired sessions are cleaned up.
 */
export function getSessionTokenFromHeaders(headers: Headers): string | undefined {
  return headers
    .get('cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_CONFIG.cookieName}=`))
    ?.split('=')[1];
}

export async function getCurrentUser(request?: Request): Promise<AuthUser | null> {
  const token = request
    ? getSessionTokenFromHeaders(request.headers)
    : (await cookies()).get(SESSION_CONFIG.cookieName)?.value;

  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          role: {
            include: {
              role_permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!session) return null;

  if (session.expires_at < new Date()) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }

  const user = session.user;
  if (user.status !== 'ACTIVE') return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
    role: {
      id: user.role.id,
      name: user.role.name,
      role_permissions: user.role.role_permissions.map((rp) => ({
        permission: { name: rp.permission.name },
      })),
    },
  };
}

/**
 * Resolve the authenticated user from the session cookie.
 *
 * The legacy x-user-id header is only accepted when explicitly enabled for test
 * compatibility. Production requests must use the session cookie and must never
 * trust a client-supplied identity header.
 */
export async function resolveUserIdFromRequest(request: Request): Promise<string | null> {
  const cookieToken = getSessionTokenFromHeaders(request.headers);

  if (cookieToken) {
    const session = await prisma.session.findUnique({
      where: { token: cookieToken },
      include: { user: true },
    });
    if (session && session.expires_at >= new Date() && session.user.status === 'ACTIVE') {
      return session.user.id;
    }
  }

  if (!isLegacyXUserIdAllowed()) {
    return null;
  }

  const headerUserId = request.headers.get('x-user-id');
  if (headerUserId) return headerUserId;

  return null;
}