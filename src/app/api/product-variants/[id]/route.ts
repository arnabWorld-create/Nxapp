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

    if (!userHasPermission(user, 'manage_variant')) {
      return NextResponse.json({ error: 'Permission denied: manage_variant required' }, { status: 403 });
    }

    const variant = await prisma.productVariant.findUnique({ where: { id } });
    if (!variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
      }
      data.status = body.status;
    }

    if (body.variant_name !== undefined) {
      const trimmed = String(body.variant_name).trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Variant name is required' }, { status: 400 });
      }
      const normalizedVariantName = normalizeText(trimmed);
      if (normalizedVariantName !== variant.normalized_variant_name) {
        const existing = await prisma.productVariant.findFirst({
          where: {
            product_id: variant.product_id,
            normalized_variant_name: normalizedVariantName,
            NOT: { id },
          },
        });
        if (existing) {
          return NextResponse.json(
            { error: 'Variant with this name already exists for this product' },
            { status: 409 }
          );
        }
      }
      data.variant_name = trimmed;
      data.normalized_variant_name = normalizedVariantName;
    }

    if (body.pack_size !== undefined) {
      data.pack_size = body.pack_size?.trim() || null;
    }

    if (body.strength !== undefined) {
      data.strength = body.strength?.trim() || null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.productVariant.update({ where: { id }, data });

    return NextResponse.json(
      {
        id: updated.id,
        variant_name: updated.variant_name,
        product_id: updated.product_id,
        pack_size: updated.pack_size,
        strength: updated.strength,
        status: updated.status,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Variant update error:', error);
    return NextResponse.json({ error: 'Failed to update variant' }, { status: 500 });
  }
}
