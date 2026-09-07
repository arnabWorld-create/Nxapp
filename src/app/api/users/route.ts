import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import {
  createUser,
  listUsers,
  serializeUser,
  USER_MANAGEMENT_PERMISSION,
  UserManagementConflictError,
  UserManagementValidationError,
} from '../../../lib/users/management';

async function authorize(request: Request) {
  const userId = await resolveUserIdFromRequest(request);
  if (!userId) return { response: NextResponse.json({ error: 'Missing authentication' }, { status: 401 }) };
  const user = await getUserById(userId);
  if (!user) return { response: NextResponse.json({ error: 'User not found' }, { status: 403 }) };
  if (!userHasPermission(user, USER_MANAGEMENT_PERMISSION)) return { response: NextResponse.json({ error: 'Permission denied' }, { status: 403 }) };
  return { user };
}

function parseStatus(value: string | null): 'ACTIVE' | 'INACTIVE' | undefined {
  if (value === 'ACTIVE' || value === 'INACTIVE') return value;
  return undefined;
}

export async function GET(request: Request) {
  try {
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10)));
    const result = await listUsers({
      search: url.searchParams.get('search')?.trim() || undefined,
      roleId: url.searchParams.get('role_id')?.trim() || undefined,
      status: parseStatus(url.searchParams.get('status')),
      page,
      pageSize,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('User list error:', error);
    return NextResponse.json({ error: 'Unable to retrieve users' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const body = await request.json();
    const user = await createUser({ name: body?.name, email: body?.email, password: body?.password, roleId: body?.role_id, status: body?.status });
    await prisma.auditLog.create({ data: { user_id: auth.user.id, action: 'USER_CREATED', entity_type: 'User', entity_id: user.id, new_value: { name: user.name, email: user.email, role: user.role.name, status: user.status } } });
    return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
  } catch (error) {
    if (error instanceof UserManagementValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UserManagementConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('User creation error:', error);
    return NextResponse.json({ error: 'Unable to create user' }, { status: 500 });
  }
}
