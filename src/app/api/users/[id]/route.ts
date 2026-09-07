import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../lib/auth';
import {
  serializeUser,
  updateUser,
  USER_MANAGEMENT_PERMISSION,
  UserManagementConflictError,
  UserManagementNotFoundError,
  UserManagementSelfProtectionError,
  UserManagementValidationError,
} from '../../../../lib/users/management';

async function authorize(request: Request) {
  const userId = await resolveUserIdFromRequest(request);
  if (!userId) return { response: NextResponse.json({ error: 'Missing authentication' }, { status: 401 }) };
  const user = await getUserById(userId);
  if (!user) return { response: NextResponse.json({ error: 'User not found' }, { status: 403 }) };
  if (!userHasPermission(user, USER_MANAGEMENT_PERMISSION)) return { response: NextResponse.json({ error: 'Permission denied' }, { status: 403 }) };
  return { user };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const body = await request.json();
    const previous = await prisma.user.findUnique({ where: { id }, select: { role_id: true } });
    const updated = await updateUser({ actorId: auth.user.id, userId: id, name: body?.name, email: body?.email, roleId: body?.role_id, status: body?.status });
    await prisma.auditLog.create({ data: { user_id: auth.user.id, action: 'USER_UPDATED', entity_type: 'User', entity_id: id, new_value: { name: updated.name, email: updated.email, role: updated.role.name, status: updated.status } } });
    if (previous && previous.role_id !== updated.role_id) {
      await prisma.auditLog.create({ data: { user_id: auth.user.id, action: 'ROLE_CHANGED', entity_type: 'User', entity_id: id, new_value: { role: updated.role.name } } });
    }
    if (updated.status === 'INACTIVE') {
      await prisma.auditLog.create({ data: { user_id: auth.user.id, action: 'USER_DEACTIVATED', entity_type: 'User', entity_id: id, new_value: { status: updated.status } } });
    } else if (body?.status === 'ACTIVE') {
      await prisma.auditLog.create({ data: { user_id: auth.user.id, action: 'USER_REACTIVATED', entity_type: 'User', entity_id: id, new_value: { status: updated.status } } });
    }
    return NextResponse.json({ user: serializeUser(updated) });
  } catch (error) {
    if (error instanceof UserManagementValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UserManagementSelfProtectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof UserManagementNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof UserManagementConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('User update error:', error);
    return NextResponse.json({ error: 'Unable to update user' }, { status: 500 });
  }
}
