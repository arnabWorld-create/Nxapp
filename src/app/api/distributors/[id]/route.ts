import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { normalizeText } from '../../../../lib/matching/utils';
import { resolveUserIdFromRequest } from '../../../../lib/auth';

function parseDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${field} must be a valid YYYY-MM-DD date`);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid YYYY-MM-DD date`);
  return date;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'manage_product')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const existing = await prisma.distributor.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Distributor not found' }, { status: 404 });
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return NextResponse.json({ error: 'Distributor name is required' }, { status: 400 });
      const normalizedName = normalizeText(name);
      const duplicate = await prisma.distributor.findFirst({ where: { normalized_name: normalizedName, NOT: { id } } });
      if (duplicate) return NextResponse.json({ error: 'Distributor with this name already exists', existingId: duplicate.id }, { status: 409 });
      data.name = name;
      data.normalized_name = normalizedName;
    }
    if (body.salesperson_user_id !== undefined) {
      const salespersonId = typeof body.salesperson_user_id === 'string' && body.salesperson_user_id.trim() ? body.salesperson_user_id.trim() : null;
      if (salespersonId && !(await prisma.user.findFirst({ where: { id: salespersonId, status: 'ACTIVE' }, select: { id: true } }))) return NextResponse.json({ error: 'Active salesperson user not found' }, { status: 400 });
      data.salesperson_user_id = salespersonId;
    }
    if (body.status !== undefined) {
      if (body.status !== 'ACTIVE' && body.status !== 'INACTIVE') return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
      data.status = body.status;
    }
    const effectiveFrom = parseDate(body.effective_from, 'effective_from');
    const effectiveTo = parseDate(body.effective_to, 'effective_to');
    if (effectiveFrom !== undefined) data.effective_from = effectiveFrom;
    if (effectiveTo !== undefined) data.effective_to = effectiveTo;
    const nextFrom = (effectiveFrom === undefined ? existing.effective_from : effectiveFrom) as Date;
    const nextTo = effectiveTo === undefined ? existing.effective_to : effectiveTo;
    if (nextTo && nextTo < nextFrom) return NextResponse.json({ error: 'effective_to must be on or after effective_from' }, { status: 400 });
    if (!Object.keys(data).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    const updated = await prisma.distributor.update({ where: { id }, data, include: { salesperson: { select: { id: true, name: true, email: true } } } });
    await prisma.auditLog.create({ data: { user_id: user.id, action: 'DISTRIBUTOR_UPDATED', entity_type: 'Distributor', entity_id: id, old_value: { name: existing.name, salesperson_user_id: existing.salesperson_user_id, status: existing.status }, new_value: data as any } });
    return NextResponse.json({ distributor: { ...updated, effective_from: updated.effective_from.toISOString().slice(0, 10), effective_to: updated.effective_to?.toISOString().slice(0, 10) ?? null } });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Distributor update error:', error);
    return NextResponse.json({ error: 'Unable to update distributor' }, { status: 500 });
  }
}
