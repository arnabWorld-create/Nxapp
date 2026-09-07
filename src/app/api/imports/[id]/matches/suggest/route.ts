/**
 * GET /api/imports/[id]/matches/suggest
 * Get match suggestions for an import row
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { matchingEngine } from '../../../../../../lib/matching/engine';
import { getUserById, userHasPermission } from '../../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../../lib/auth';

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
    const { importRowId } = body;

    if (!importRowId) {
      return NextResponse.json({ error: 'importRowId required' }, { status: 400 });
    }

    // Get import row
    const importRow = await prisma.importRow.findUnique({
      where: { id: importRowId },
      select: {
        id: true,
        import_id: true,
        raw_data_json: true,
        parsed_data_json: true,
      },
    });

    if (!importRow) {
      return NextResponse.json({ error: 'Import row not found' }, { status: 404 });
    }

    if (importRow.import_id !== id) {
      return NextResponse.json({ error: 'Import row does not belong to this import' }, { status: 400 });
    }

    // Extract source item name
    const rawData = importRow.raw_data_json as Record<string, unknown>;
    const parsedData = importRow.parsed_data_json as Record<string, unknown> | null;
    const normalizedData = parsedData?.normalizedData as Record<string, unknown> | undefined;

    const sourceName = (
      normalizedData?.source_item_name ||
      rawData['Source Item'] ||
      rawData['source_item_name'] ||
      rawData['Item'] ||
      ''
    ) as string;
    if (!sourceName) {
      return NextResponse.json({ error: 'Source item name not found in row' }, { status: 400 });
    }

    // Get match suggestions
    const result = await matchingEngine.suggestMatches({
      importRowId: importRow.id,
      sourceName,
      normalizedSourceName: normalizedData?.source_item_name as string | undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Match suggestion error:', error);
    return NextResponse.json({ error: 'Failed to suggest matches' }, { status: 500 });
  }
}
