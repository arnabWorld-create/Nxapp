import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { createDivision, MasterAlreadyExistsError } from '../../../lib/master-data/create';

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'manage_product')) {
      return NextResponse.json({ error: 'Permission denied: manage_product required' }, { status: 403 });
    }

    const body = await request.json();
    const division = await createDivision({ name: body?.name, code: body?.code });
    await prisma.auditLog.create({
      data: {
        user_id: user.id,
        action: 'DIVISION_CREATED',
        entity_type: 'Division',
        entity_id: division.id,
        new_value: { name: division.name, code: division.code },
        reason: 'Division created',
      },
    });
    return NextResponse.json({ id: division.id, name: division.name, code: division.code, status: division.status }, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof MasterAlreadyExistsError) return NextResponse.json({ error: error.message, existingId: error.existingId }, { status: 409 });
    console.error('Division creation error:', error);
    return NextResponse.json({ error: 'Failed to create division' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'manage_product')) {
      return NextResponse.json({ error: 'Permission denied: manage_product required' }, { status: 403 });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
    const divisions = await prisma.division.findMany({
      where: { status: 'ACTIVE', ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
    return NextResponse.json({ divisions }, { status: 200 });
  } catch (error) {
    console.error('Division search error:', error);
    return NextResponse.json({ error: 'Failed to search divisions' }, { status: 500 });
  }
}