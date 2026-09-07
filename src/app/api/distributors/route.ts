import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { normalizeText } from '../../../lib/matching/utils';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import type { DistributorStatus } from '@prisma/client';

async function authorize(request: Request, write = false) {
  const userId = await resolveUserIdFromRequest(request);
  const user = userId ? await getUserById(userId) : null;
  if (!userId || !user) return { response: NextResponse.json({ error: 'Missing authentication' }, { status: 401 }) };
  if (!userHasPermission(user, write ? 'manage_product' : 'view_statement')) {
    return { response: NextResponse.json({ error: 'Permission denied' }, { status: 403 }) };
  }
  return { user };
}

function parseDate(value: unknown, field: string, required = false): Date | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new TypeError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${field} must be a valid YYYY-MM-DD date`);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid YYYY-MM-DD date`);
  return date;
}

function serialize(distributor: any) {
  return {
    id: distributor.id,
    name: distributor.name,
    normalized_name: distributor.normalized_name,
    status: distributor.status,
    effective_from: distributor.effective_from.toISOString().slice(0, 10),
    effective_to: distributor.effective_to?.toISOString().slice(0, 10) ?? null,
    salesperson: distributor.salesperson ? { id: distributor.salesperson.id, name: distributor.salesperson.name, email: distributor.salesperson.email } : null,
    created_at: distributor.created_at.toISOString(),
    updated_at: distributor.updated_at.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim() ?? '';
    const status = url.searchParams.get('status');
    const requestedSalesperson = url.searchParams.get('salesperson_id')?.trim();
    const canManage = userHasPermission(auth.user, 'manage_product');
    const salespersonId = canManage ? requestedSalesperson : auth.user.id;
    if (status && status !== 'ACTIVE' && status !== 'INACTIVE') return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
    const distributors = await prisma.distributor.findMany({
      where: {
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(status ? { status: status as DistributorStatus } : {}),
        ...(salespersonId ? { salesperson_user_id: salespersonId } : {}),
      },
      include: { salesperson: { select: { id: true, name: true, email: true } } },
      orderBy: { name: 'asc' },
    });
    const salespersons = canManage ? await prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }) : [];
    return NextResponse.json({ distributors: distributors.map(serialize), salespersons });
  } catch (error) {
    console.error('Distributor list error:', error);
    return NextResponse.json({ error: 'Unable to retrieve distributors' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorize(request, true);
    if ('response' in auth) return auth.response;
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Distributor name is required' }, { status: 400 });
    const effectiveFrom = parseDate(body?.effective_from, 'effective_from', true);
    const effectiveTo = parseDate(body?.effective_to, 'effective_to');
    if (effectiveTo && effectiveFrom && effectiveTo < effectiveFrom) return NextResponse.json({ error: 'effective_to must be on or after effective_from' }, { status: 400 });
    const normalizedName = normalizeText(name);
    const existing = await prisma.distributor.findUnique({ where: { normalized_name: normalizedName } });
    if (existing) return NextResponse.json({ error: 'Distributor with this name already exists', existingId: existing.id }, { status: 409 });
    const salespersonId = typeof body?.salesperson_user_id === 'string' && body.salesperson_user_id.trim() ? body.salesperson_user_id.trim() : null;
    if (salespersonId) {
      const salesperson = await prisma.user.findFirst({ where: { id: salespersonId, status: 'ACTIVE' }, select: { id: true } });
      if (!salesperson) return NextResponse.json({ error: 'Active salesperson user not found' }, { status: 400 });
    }
    const distributor = await prisma.distributor.create({ data: { name, normalized_name: normalizedName, effective_from: effectiveFrom!, effective_to: effectiveTo, salesperson_user_id: salespersonId }, include: { salesperson: { select: { id: true, name: true, email: true } } } });
    await prisma.auditLog.create({ data: { user_id: auth.user.id, action: 'DISTRIBUTOR_CREATED', entity_type: 'Distributor', entity_id: distributor.id, new_value: { name: distributor.name, salesperson_user_id: distributor.salesperson_user_id, status: distributor.status } } });
    return NextResponse.json({ distributor: serialize(distributor) }, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Distributor creation error:', error);
    return NextResponse.json({ error: 'Unable to create distributor' }, { status: 500 });
  }
}
