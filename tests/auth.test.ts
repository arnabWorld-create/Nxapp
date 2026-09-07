import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

import prisma from '../src/lib/prisma';
import { seedTestDatabase, cleanupTestData } from './test-setup';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';
import { authenticateUser, createSession, deleteSession, getCurrentUser, resolveUserIdFromRequest } from '../src/lib/auth';
import { POST as loginPOST } from '../src/app/api/auth/login/route';
import { POST as logoutPOST } from '../src/app/api/auth/logout/route';
import { GET as meGET } from '../src/app/api/auth/me/route';

const createdUsers: string[] = [];
const createdSessions: string[] = [];

before(async () => {
  await seedTestDatabase();
});

after(async () => {
  await cleanupTestData();
  await prisma.session.deleteMany({});
});

async function createUserWithPassword(roleName: string, password: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  assert(role, `Expected role ${roleName}`);
  const user = await prisma.user.create({
    data: {
      name: `auth-${roleName.toLowerCase()}-${Date.now()}`,
      email: `auth-${roleName.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      password_hash: hashPassword(password),
      role_id: role.id,
      status: 'ACTIVE',
    },
  });
  createdUsers.push(user.id);
  return user;
}

test('Authentication - Password hashing', async () => {
  const hash = hashPassword('secret123');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('secret123', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  // Different hashes for same password
  const hash2 = hashPassword('secret123');
  assert.notEqual(hash, hash2);
});

test('Authentication - Login API success', async () => {
  const user = await createUserWithPassword('MANAGER', 'manager-pass');
  const response = await loginPOST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'manager-pass' }),
    })
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, user.id);
  assert.equal(body.user.role, 'MANAGER');
  // Cookie set
  const setCookie = response.headers.get('set-cookie');
  assert(setCookie, 'Expected session cookie');
  assert.match(setCookie, /nxapp_session=/);
});

test('Authentication - Login API rejects wrong password', async () => {
  const user = await createUserWithPassword('MANAGER', 'manager-pass');
  const response = await loginPOST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'incorrect' }),
    })
  );
  assert.equal(response.status, 401);
});

test('Authentication - Login API rejects missing fields', async () => {
  const response = await loginPOST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '' }),
    })
  );
  assert.equal(response.status, 400);
});

test('Authentication - Session lifecycle', async () => {
  const user = await createUserWithPassword('ADMIN', 'admin-pass');
  const token = await createSession(user.id);
  createdSessions.push(token);

  const resolved = await authenticateUser(user.email, 'admin-pass');
  assert(resolved, 'User should authenticate');
  assert.equal(resolved?.id, user.id);

  // Delete session
  await deleteSession(token);
});

test('Authentication - Inactive user cannot authenticate', async () => {
  const role = await prisma.role.findUnique({ where: { name: 'SALES_USER' } });
  const user = await prisma.user.create({
    data: {
      name: 'inactive-user',
      email: `inactive-${Date.now()}@example.com`,
      password_hash: hashPassword('pass123'),
      role_id: role!.id,
      status: 'INACTIVE',
    },
  });
  createdUsers.push(user.id);

  const resolved = await authenticateUser(user.email, 'pass123');
  assert.equal(resolved, null);
});

test('Authentication - Logout clears session', async () => {
  const user = await createUserWithPassword('MANAGER', 'logout-pass');
  const token = await createSession(user.id);
  createdSessions.push(token);

  const response = await logoutPOST(
    new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `nxapp_session=${token}` },
    })
  );
  assert.equal(response.status, 200);

  const session = await prisma.session.findUnique({ where: { token } });
  assert.equal(session, null);
});

test('Authentication - /api/auth/me returns current user from session', async () => {
  const user = await createUserWithPassword('ADMIN', 'me-pass');
  const token = await createSession(user.id);
  createdSessions.push(token);

  const response = await meGET(
    new Request('http://localhost/api/auth/me', {
      headers: { cookie: `nxapp_session=${token}` },
    })
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, user.id);
  assert.equal(body.user.email, user.email);
});

test('Authentication - forged x-user-id is ignored when legacy override is disabled', async () => {
  const previous = process.env.ALLOW_LEGACY_X_USER_ID;
  process.env.ALLOW_LEGACY_X_USER_ID = 'false';

  try {
    const user = await createUserWithPassword('MANAGER', 'guard-pass');
    const request = new Request('http://localhost/api/test', {
      headers: { 'x-user-id': user.id },
    });
    const resolved = await resolveUserIdFromRequest(request);
    assert.equal(resolved, null);
  } finally {
    if (previous === undefined) {
      delete process.env.ALLOW_LEGACY_X_USER_ID;
    } else {
      process.env.ALLOW_LEGACY_X_USER_ID = previous;
    }
  }
});

test('Authentication - logout invalidates subsequent me lookup', async () => {
  const user = await createUserWithPassword('MANAGER', 'logout-me-pass');
  const token = await createSession(user.id);
  createdSessions.push(token);

  const logoutResponse = await logoutPOST(
    new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `nxapp_session=${token}` },
    })
  );
  assert.equal(logoutResponse.status, 200);

  const meResponse = await meGET(
    new Request('http://localhost/api/auth/me', {
      headers: { cookie: `nxapp_session=${token}` },
    })
  );
  assert.equal(meResponse.status, 401);
});
