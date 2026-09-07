import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { createProduct, MasterAlreadyExistsError, MasterParentNotFoundError } from '../../../lib/master-data/create';

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

    if (!userHasPermission(user, 'manage_product')) {
      return NextResponse.json({ error: 'Permission denied: manage_product required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, code, brand_id, division_id } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    }

    const product = await createProduct({ name, code, brandId: brand_id, divisionId: division_id });

    if (!product.brand_id) {
      await prisma.auditLog.create({
        data: {
          user_id: user.id,
          action: 'MASTER_MEDICINE_ITEM_CREATED',
          entity_type: 'Product',
          entity_id: product.id,
          new_value: { name: product.name, divisionId: product.division_id },
          reason: 'Direct Master Medicine Item created',
        },
      });
    }

    return NextResponse.json(
      {
        id: product.id,
        name: product.name,
        code: product.code,
        brand_id: product.brand_id,
        division_id: product.division_id,
        createdAt: product.created_at.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof MasterParentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof MasterAlreadyExistsError) return NextResponse.json({ error: error.message, existingId: error.existingId }, { status: 409 });
    console.error('Product creation error:', error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const brandId = url.searchParams.get('brand_id');
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10));

    const whereConditions: any = {};
    if (q) {
      whereConditions.name = {
        contains: q,
        mode: 'insensitive',
      };
    }
    if (brandId) {
      whereConditions.brand_id = brandId;
    }

    const products = await prisma.product.findMany({
      where: whereConditions,
      select: {
        id: true,
        name: true,
        code: true,
        brand_id: true,
        status: true,
        brand: { select: { name: true } },
        division: { select: { id: true, name: true } },
      },
      take: limit,
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json(
      {
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          brand_id: p.brand_id,
          brand_name: p.brand?.name ?? null,
          division_id: p.division?.id ?? null,
          division_name: p.division?.name ?? null,
          status: p.status,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Product search error:', error);
    return NextResponse.json({ error: 'Failed to search products' }, { status: 500 });
  }
}
