import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { normalizeText } from '../../../../lib/matching/utils';
import { resolveUserIdFromRequest } from '../../../../lib/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const userId = await resolveUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 });
    }

    if (!userHasPermission(user, 'manage_brand')) {
      return NextResponse.json({ error: 'Permission denied: manage_brand required' }, { status: 403 });
    }

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
      }
      data.status = body.status;
    }

    if (body.name !== undefined) {
      const trimmed = String(body.name).trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Brand name is required' }, { status: 400 });
      }
      const normalizedName = normalizeText(trimmed);
      if (normalizedName !== brand.normalized_name) {
        const existing = await prisma.brand.findUnique({ where: { normalized_name: normalizedName } });
        if (existing) {
          return NextResponse.json({ error: 'Brand with this name already exists' }, { status: 409 });
        }
      }
      data.name = trimmed;
      data.normalized_name = normalizedName;
    }

    if (body.code !== undefined) {
      data.code = body.code?.trim() || null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.brand.update({ where: { id }, data });

    return NextResponse.json(
      { id: updated.id, name: updated.name, code: updated.code, status: updated.status },
      { status: 200 }
    );
  } catch (error) {
    console.error('Brand update error:', error);
    return NextResponse.json({ error: 'Failed to update brand' }, { status: 500 });
  }
}
