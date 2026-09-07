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

    if (!userHasPermission(user, 'manage_product')) {
      return NextResponse.json({ error: 'Permission denied: manage_product required' }, { status: 403 });
    }

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
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
        return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
      }
      const normalizedName = normalizeText(trimmed);
      if (normalizedName !== product.normalized_name) {
        const existing = await prisma.product.findFirst({
          where: {
            brand_id: product.brand_id,
            normalized_name: normalizedName,
            NOT: { id },
          },
        });
        if (existing) {
          return NextResponse.json(
            { error: 'Product with this name already exists for this brand' },
            { status: 409 }
          );
        }
      }
      data.name = trimmed;
      data.normalized_name = normalizedName;
    }

    if (body.code !== undefined) {
      data.code = body.code?.trim() || null;
    }

    if (body.division_id !== undefined) {
      if (!body.division_id) {
        return NextResponse.json({ error: 'Division ID is required for a Product' }, { status: 400 });
      }
      const division = await prisma.division.findUnique({ where: { id: body.division_id }, select: { id: true } });
      if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
      const normalizedForScope = typeof data.normalized_name === 'string' ? data.normalized_name : product.normalized_name;
      const existing = await prisma.product.findFirst({ where: { division_id: body.division_id, normalized_name: normalizedForScope, NOT: { id } } });
      if (existing) return NextResponse.json({ error: 'Product with this name already exists in this division' }, { status: 409 });
      data.division_id = body.division_id;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.product.update({ where: { id }, data });

    return NextResponse.json(
      { id: updated.id, name: updated.name, code: updated.code, brand_id: updated.brand_id, status: updated.status },
      { status: 200 }
    );
  } catch (error) {
    console.error('Product update error:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}
