import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { normalizeText } from '../../../../lib/matching/utils';
import { resolveUserIdFromRequest } from '../../../../lib/auth';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'manage_product')) return NextResponse.json({ error: 'Permission denied: manage_product required' }, { status: 403 });

    const division = await prisma.division.findUnique({ where: { id } });
    if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: 'Division name is required' }, { status: 400 });
      const normalizedName = normalizeText(name);
      const existing = await prisma.division.findFirst({ where: { normalized_name: normalizedName, NOT: { id } } });
      if (existing) return NextResponse.json({ error: 'Division with this name already exists' }, { status: 409 });
      data.name = name;
      data.normalized_name = normalizedName;
    }
    if (body.code !== undefined) data.code = typeof body.code === 'string' ? body.code.trim() || null : null;
    if (body.status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(body.status)) return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
      data.status = body.status;
    }
    if (!Object.keys(data).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    const updated = await prisma.division.update({ where: { id }, data });
    await prisma.auditLog.create({ data: { user_id: user.id, action: 'DIVISION_UPDATED', entity_type: 'Division', entity_id: id, old_value: { name: division.name, code: division.code, status: division.status }, new_value: data as any, reason: 'Division updated' } });
    return NextResponse.json({ id: updated.id, name: updated.name, code: updated.code, status: updated.status }, { status: 200 });
  } catch (error) {
    console.error('Division update error:', error);
    return NextResponse.json({ error: 'Failed to update division' }, { status: 500 });
  }
}