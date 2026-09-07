import prisma from '../prisma';
import { hashPassword } from '../auth/password';

export const USER_MANAGEMENT_PERMISSION = 'manage_user';

export class UserManagementValidationError extends Error {}
export class UserManagementConflictError extends Error {}
export class UserManagementNotFoundError extends Error {}
export class UserManagementSelfProtectionError extends Error {}

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role_id: string;
  role: { id: string; name: string };
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
};

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role_id: true,
  status: true,
  created_at: true,
  updated_at: true,
  role: { select: { id: true, name: true } },
} as const;

export function serializeUser(user: SafeUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
    role: user.role,
    status: user.status,
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
  };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UserManagementValidationError(`${field} is required`);
  }
  return value.trim();
}

function validateEmail(value: unknown): string {
  const email = requiredText(value, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UserManagementValidationError('Email must be valid');
  }
  return email;
}

function validateStatus(value: unknown): 'ACTIVE' | 'INACTIVE' {
  if (value !== 'ACTIVE' && value !== 'INACTIVE') {
    throw new UserManagementValidationError('Status must be ACTIVE or INACTIVE');
  }
  return value;
}

async function getRole(roleId: unknown) {
  const roleIdValue = requiredText(roleId, 'Role');
  const role = await prisma.role.findUnique({ where: { id: roleIdValue }, select: { id: true, name: true } });
  if (!role) throw new UserManagementValidationError('Role not found');
  return role;
}

function mapDatabaseError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    throw new UserManagementConflictError('A user with this email already exists');
  }
  throw error;
}

export async function listUsers(input: {
  search?: string;
  roleId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  page: number;
  pageSize: number;
}) {
  const where = {
    ...(input.search ? { OR: [{ name: { contains: input.search, mode: 'insensitive' as const } }, { email: { contains: input.search, mode: 'insensitive' as const } }] } : {}),
    ...(input.roleId ? { role_id: input.roleId } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const [users, totalCount, roles] = await Promise.all([
    prisma.user.findMany({ where, select: safeUserSelect, orderBy: { created_at: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.user.count({ where }),
    prisma.role.findMany({ select: { id: true, name: true, description: true }, orderBy: { name: 'asc' } }),
  ]);
  return { users: users.map(serializeUser), roles, pagination: { page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(totalCount / input.pageSize), totalCount } };
}

export async function createUser(input: { name: unknown; email: unknown; password: unknown; roleId: unknown; status: unknown }) {
  const name = requiredText(input.name, 'Name');
  const email = validateEmail(input.email);
  const password = requiredText(input.password, 'Password');
  if (password.length < 8) throw new UserManagementValidationError('Password must be at least 8 characters');
  const role = await getRole(input.roleId);
  const status = validateStatus(input.status);
  try {
    return await prisma.user.create({ data: { name, email, password_hash: hashPassword(password), role_id: role.id, status }, select: safeUserSelect });
  } catch (error) {
    return mapDatabaseError(error);
  }
}

export async function updateUser(input: { actorId: string; userId: string; name: unknown; email: unknown; roleId: unknown; status: unknown }) {
  const existing = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role_id: true, status: true } });
  if (!existing) throw new UserManagementNotFoundError('User not found');
  const name = requiredText(input.name, 'Name');
  const email = validateEmail(input.email);
  const role = await getRole(input.roleId);
  const status = validateStatus(input.status);
  if (input.actorId === input.userId && (status === 'INACTIVE' || role.id !== existing.role_id)) {
    throw new UserManagementSelfProtectionError('You cannot deactivate yourself or remove your own current role');
  }
  try {
    return await prisma.user.update({ where: { id: input.userId }, data: { name, email, role_id: role.id, status }, select: safeUserSelect });
  } catch (error) {
    return mapDatabaseError(error);
  }
}

export { safeUserSelect };
