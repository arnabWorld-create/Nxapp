import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { resolveUserIdFromRequest } from '../../../../../../lib/auth';
import { getUserById, userHasPermission } from '../../../../../../lib/import/upload';
import { createBrand, createProduct, createVariant, MasterAlreadyExistsError, MasterParentNotFoundError } from '../../../../../../lib/master-data/create';
import { normalizeSourceItemName, normalizeText } from '../../../../../../lib/matching/utils';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: importId } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });

    const body = await request.json();
    const entityType = body?.entityType;
    const permission = entityType === 'BRAND' ? 'manage_brand' : entityType === 'PRODUCT' ? 'manage_product' : entityType === 'VARIANT' ? 'manage_variant' : null;
    if (!permission) return NextResponse.json({ error: 'A valid entityType is required' }, { status: 400 });
    if (!userHasPermission(user, permission)) return NextResponse.json({ error: `Permission denied: ${permission} required` }, { status: 403 });

    const importRecord = await prisma.import.findUnique({ where: { id: importId }, select: { uploaded_by: true } });
    if (!importRecord) return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const row = await prisma.importRow.findUnique({ where: { id: body?.importRowId }, select: { import_id: true, row_type: true, parsed_data_json: true } });
    if (!row) return NextResponse.json({ error: 'Import row not found' }, { status: 404 });
    if (row.import_id !== importId) return NextResponse.json({ error: 'Import row does not belong to this import' }, { status: 400 });
    if (row.row_type !== 'DATA_ROW') return NextResponse.json({ error: 'Only DATA_ROW rows can create masters' }, { status: 400 });
    if (entityType === 'PRODUCT' && (typeof body?.divisionId !== 'string' || !body.divisionId.trim())) {
      return NextResponse.json({ error: 'Division ID is required for a Product' }, { status: 400 });
    }
    if (entityType === 'PRODUCT') {
      const division = await prisma.division.findFirst({ where: { id: body.divisionId, status: 'ACTIVE' }, select: { id: true } });
      if (!division) return NextResponse.json({ error: 'Active Division not found' }, { status: 404 });
    }

    let created: { id: string; name?: string; variant_name?: string; brand_id?: string | null; product_id?: string; division_id?: string | null; division?: { id: string; name: string } | null };
    let reusedExistingProduct = false;
    if (entityType === 'BRAND') {
      created = await createBrand({ name: body.name, code: body.code });
    } else if (entityType === 'PRODUCT') {
      const normalizedName = normalizeText(typeof body.name === 'string' ? body.name : '');
      const existingProduct = await prisma.product.findFirst({
        where: { normalized_name: normalizedName, division_id: body.divisionId },
        select: { id: true, name: true, brand_id: true, division_id: true, division: { select: { id: true, name: true } } },
      });
      if (existingProduct) {
        created = existingProduct;
        reusedExistingProduct = true;
      } else {
        created = await createProduct({ name: body.name, code: body.code, brandId: body.brandId, divisionId: body.divisionId });
      }
      if (!created.division) {
        created = await prisma.product.findUniqueOrThrow({
          where: { id: created.id },
          select: { id: true, name: true, brand_id: true, division_id: true, division: { select: { id: true, name: true } } },
        });
      }
    } else {
      created = await createVariant({ name: body.name, productId: body.productId, packSize: body.packSize, strength: body.strength });
    }

    if (entityType === 'PRODUCT') {
      const parsedData = row.parsed_data_json as { normalizedData?: { source_item_name?: unknown } } | null;
      const sourceName = parsedData?.normalizedData?.source_item_name;
      const normalizedSourceName = typeof sourceName === 'string' ? normalizeSourceItemName(sourceName) : '';
      if (normalizedSourceName) {
        await prisma.$transaction(async (transaction) => {
          await transaction.importRow.update({
            where: { id: body.importRowId },
            data: {
              confirmed_brand_id: created.brand_id ?? null,
              confirmed_product_id: created.id,
              confirmed_variant_id: null,
              confirmed_by_user_id: user.id,
              confirmed_at: new Date(),
              match_reason: 'AUTO_MATCHED:MASTER_CREATED',
            },
          });
          await transaction.learnedMapping.upsert({
            where: { normalized_source_name_entity_key: { normalized_source_name: normalizedSourceName, entity_key: `PRODUCT:${created.id}` } },
            create: {
              normalized_source_name: normalizedSourceName,
              entity_key: `PRODUCT:${created.id}`,
              entity_type: 'PRODUCT',
              brand_id: created.brand_id ?? null,
              product_id: created.id,
              division_id: body.divisionId,
              confirmed_by_user_id: user.id,
            },
            update: {
              brand_id: created.brand_id ?? null,
              product_id: created.id,
              division_id: body.divisionId,
              confirmed_by_user_id: user.id,
              confirmed_at: new Date(),
            },
          });
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        user_id: user.id,
        action: entityType === 'PRODUCT' && !created.brand_id ? 'MASTER_MEDICINE_ITEM_CREATED' : 'IMPORT_REVIEW_MASTER_CREATED',
        entity_type: entityType,
        entity_id: created.id,
        new_value: { importId, importRowId: body.importRowId, entityType, name: body.name, brandId: body.brandId ?? null, productId: body.productId ?? null },
        reason: reusedExistingProduct ? 'Existing Product reused from Import Review' : entityType === 'PRODUCT' && !created.brand_id ? 'Direct Master Medicine Item created from Import Review' : 'Master created from Import Review',
      },
    });
    return NextResponse.json({ entityType, master: created, reusedExistingProduct, importId, importRowId: body.importRowId }, { status: reusedExistingProduct ? 200 : 201 });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof MasterParentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof MasterAlreadyExistsError) return NextResponse.json({ error: error.message, existingId: error.existingId }, { status: 409 });
    console.error('Import review master creation error:', error);
    return NextResponse.json({ error: 'Failed to create master from import review' }, { status: 500 });
  }
}
