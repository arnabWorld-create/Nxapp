import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { createBrand, MasterAlreadyExistsError } from '../../../lib/master-data/create';

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

    if (!userHasPermission(user, 'manage_brand')) {
      return NextResponse.json({ error: 'Permission denied: manage_brand required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, code } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Brand name is required' }, { status: 400 });
    }

    const brand = await createBrand({ name, code });

    return NextResponse.json(
      {
        id: brand.id,
        name: brand.name,
        code: brand.code,
        createdAt: brand.created_at.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof MasterAlreadyExistsError) return NextResponse.json({ error: error.message, existingId: error.existingId }, { status: 409 });
    console.error('Brand creation error:', error);
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10));

    const whereConditions: any = {};
    if (q) {
      whereConditions.name = {
        contains: q,
        mode: 'insensitive',
      };
    }

    const brands = await prisma.brand.findMany({
      where: whereConditions,
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
      },
      take: limit,
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json({ brands }, { status: 200 });
  } catch (error) {
    console.error('Brand search error:', error);
    return NextResponse.json({ error: 'Failed to search brands' }, { status: 500 });
  }
}
