/**
 * POST /api/imports/[id]/matches/confirm
 * Confirm a match selection for an import row
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../../lib/auth';
import { normalizeSourceItemName } from '../../../../../../lib/matching/utils';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = await resolveUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'User authentication required' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    // Check permission
    if (!(await userHasPermission(user, 'review_import'))) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Verify user owns import or is admin
    const importRecord = await prisma.import.findUnique({
      where: { id },
      select: { uploaded_by: true },
    });

    if (!importRecord) {
      return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    }

    const isAdmin = user.role?.name === 'ADMIN';
    if (!isAdmin && importRecord.uploaded_by !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get request body
    const body = await request.json();
    const { importRowId, selectedCandidateId, reason, action } = body;

    if (!importRowId) {
      return NextResponse.json({ error: 'importRowId required' }, { status: 400 });
    }

    // Get import row
    const importRow = await prisma.importRow.findUnique({
      where: { id: importRowId },
      select: {
        id: true,
        import_id: true,
        parsed_data_json: true,
      },
    });

    if (!importRow) {
      return NextResponse.json({ error: 'Import row not found' }, { status: 404 });
    }

    if (importRow.import_id !== id) {
      return NextResponse.json({ error: 'Import row does not belong to this import' }, { status: 400 });
    }

    // Handle different actions
    if (action === 'reject') {
      // User rejected all suggestions
      await prisma.importRow.update({
        where: { id: importRowId },
        data: {
          suggested_brand_id: null,
          suggested_product_id: null,
          suggested_variant_id: null,
          match_reason: reason || 'MATCH_REJECTED',
        },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          user_id: userId,
          action: 'MATCH_REJECTED',
          entity_type: 'ImportRow',
          entity_id: importRowId,
          reason: reason || 'User rejected all match suggestions',
        },
      });

      return NextResponse.json({ status: 'rejected' }, { status: 200 });
    }

    if (action === 'leave-unmatched') {
      // User chose to leave unmatched
      await prisma.importRow.update({
        where: { id: importRowId },
        data: {
          suggested_brand_id: null,
          suggested_product_id: null,
          suggested_variant_id: null,
          match_reason: null,
        },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          user_id: userId,
          action: 'MATCH_LEFT_UNMATCHED',
          entity_type: 'ImportRow',
          entity_id: importRowId,
          reason: reason || 'User left row unmatched',
        },
      });

      return NextResponse.json({ status: 'unmatched' }, { status: 200 });
    }

    if (!selectedCandidateId) {
      return NextResponse.json(
        { error: 'importRowId and selectedCandidateId required' },
        { status: 400 }
      );
    }

    // Confirm selection (default action)
    // Parse selectedCandidateId to determine entity type
    // Format: "ENTITY_TYPE:entity_id"
    const [entityType, entityId] = selectedCandidateId.split(':');

    if (!entityType || !entityId) {
      return NextResponse.json({ error: 'Invalid selectedCandidateId format' }, { status: 400 });
    }

    // Verify entity exists
    if (entityType === 'BRAND') {
      const brand = await prisma.brand.findUnique({ where: { id: entityId } });
      if (!brand) {
        return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
      }

      await prisma.importRow.update({
        where: { id: importRowId },
        data: {
          confirmed_brand_id: entityId,
          confirmed_product_id: null,
          confirmed_variant_id: null,
          confirmed_by_user_id: userId,
          confirmed_at: new Date(),
          match_reason: reason || 'User confirmed brand match',
        },
      });
    } else if (entityType === 'PRODUCT') {
      const product = await prisma.product.findUnique({ where: { id: entityId } });
      if (!product) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }

      await prisma.importRow.update({
        where: { id: importRowId },
        data: {
          confirmed_brand_id: product.brand_id,
          confirmed_product_id: entityId,
          confirmed_variant_id: null,
          confirmed_by_user_id: userId,
          confirmed_at: new Date(),
          match_reason: reason || 'User confirmed product match',
        },
      });
    } else if (entityType === 'VARIANT') {
      const variant = await prisma.productVariant.findUnique({
        where: { id: entityId },
        select: { product_id: true, product: { select: { brand_id: true } } },
      });

      if (!variant) {
        return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
      }

      await prisma.importRow.update({
        where: { id: importRowId },
        data: {
          confirmed_brand_id: variant.product.brand_id,
          confirmed_product_id: variant.product_id,
          confirmed_variant_id: entityId,
          confirmed_by_user_id: userId,
          confirmed_at: new Date(),
          match_reason: reason || 'User confirmed variant match',
        },
      });
    } else {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    const confirmed = await prisma.importRow.findUnique({
      where: { id: importRowId },
      select: {
        confirmed_brand_id: true,
        confirmed_product_id: true,
        confirmed_variant_id: true,
        confirmed_product: { select: { division_id: true } },
        confirmed_variant: { select: { product: { select: { division_id: true } } } },
      },
    });
    const parsedData = importRow.parsed_data_json as { normalizedData?: { source_item_name?: unknown } } | null;
    const sourceName = parsedData?.normalizedData?.source_item_name;
    const normalizedSourceName = typeof sourceName === 'string' ? normalizeSourceItemName(sourceName) : '';
    const targetId = confirmed?.confirmed_variant_id || confirmed?.confirmed_product_id || confirmed?.confirmed_brand_id;
    if (normalizedSourceName && targetId && confirmed) {
      const entityKey = `${entityType}:${targetId}`;
      const existingMapping = await prisma.learnedMapping.findUnique({
        where: { normalized_source_name_entity_key: { normalized_source_name: normalizedSourceName, entity_key: entityKey } },
      });
      await prisma.learnedMapping.upsert({
        where: { normalized_source_name_entity_key: { normalized_source_name: normalizedSourceName, entity_key: entityKey } },
        create: {
          normalized_source_name: normalizedSourceName,
          entity_key: entityKey,
          entity_type: entityType,
          brand_id: confirmed.confirmed_brand_id,
          product_id: confirmed.confirmed_product_id,
          variant_id: confirmed.confirmed_variant_id,
          division_id: confirmed.confirmed_product?.division_id ?? confirmed.confirmed_variant?.product.division_id ?? null,
          confirmed_by_user_id: userId,
        },
        update: { confirmed_by_user_id: userId, confirmed_at: new Date() },
      });
      if (!existingMapping) {
        await prisma.auditLog.create({
          data: {
            user_id: userId,
            action: 'MATCH_LEARNED',
            entity_type: 'LearnedMapping',
            entity_id: entityKey,
            new_value: { normalizedSourceName, entityType, targetId },
            reason: 'First explicit confirmation of source-to-master mapping',
          },
        });
      }
    }

    // Audit
    await prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'MATCH_CONFIRMED',
        entity_type: 'ImportRow',
        entity_id: importRowId,
        new_value: {
          entityType,
          entityId,
          reason,
        },
        reason: reason || 'User confirmed match selection',
      },
    });

    return NextResponse.json(
      {
        status: 'confirmed',
        entityType,
        entityId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Match confirmation error:', error);
    return NextResponse.json({ error: 'Failed to confirm match' }, { status: 500 });
  }
}
