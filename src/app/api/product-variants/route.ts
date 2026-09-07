import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { createVariant, MasterAlreadyExistsError, MasterParentNotFoundError } from '../../../lib/master-data/create';

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const { name, code, product_id, pack_size, strength } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Variant name is required' }, { status: 400 });
    }

    if (!product_id) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const variant = await createVariant({ name, productId: product_id, packSize: pack_size, strength });

    return NextResponse.json(
      {
        id: variant.id,
        variant_name: variant.variant_name,
        product_id: variant.product_id,
        pack_size: variant.pack_size,
        strength: variant.strength,
        createdAt: variant.created_at.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof MasterParentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof MasterAlreadyExistsError) return NextResponse.json({ error: error.message, existingId: error.existingId }, { status: 409 });
    console.error('Variant creation error:', error);
    return NextResponse.json({ error: 'Failed to create variant' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const productId = url.searchParams.get('product_id');
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10));

    const whereConditions: any = {};
    if (q) {
      whereConditions.variant_name = {
        contains: q,
        mode: 'insensitive',
      };
    }
    if (productId) {
      whereConditions.product_id = productId;
    }

    const variants = await prisma.productVariant.findMany({
      where: whereConditions,
      select: {
        id: true,
        variant_name: true,
        pack_size: true,
        strength: true,
        product_id: true,
        status: true,
        product: { select: { name: true, brand_id: true, brand: { select: { name: true } } } },
      },
      take: limit,
      orderBy: {
        variant_name: 'asc',
      },
    });

    return NextResponse.json(
      {
        variants: variants.map((v) => ({
          id: v.id,
          variant_name: v.variant_name,
          pack_size: v.pack_size,
          strength: v.strength,
          product_id: v.product_id,
          product_name: v.product.name,
          brand_id: v.product.brand_id,
          brand_name: v.product.brand?.name ?? null,
          status: v.status,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Variant search error:', error);
    return NextResponse.json({ error: 'Failed to search variants' }, { status: 500 });
  }
}
