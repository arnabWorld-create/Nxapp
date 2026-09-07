import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';
import { processImport } from '../../../../../lib/import/process';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: importId } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'review_import')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });

    const existing = await prisma.import.findUnique({ where: { id: importId }, select: { uploaded_by: true, status: true } });
    if (!existing) return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    if (existing.uploaded_by !== user.id && user.role?.name !== 'ADMIN') return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.import.updateMany({
        where: { id: importId, status: 'FAILED', statement_id: null },
        data: { status: 'PROCESSING', failure_stage: null, failure_message: null, failed_at: null },
      });
      if (claimed.count !== 1) return { conflict: true } as const;
      await tx.importRow.deleteMany({ where: { import_id: importId } });
      await tx.auditLog.create({ data: { user_id: user.id, action: 'IMPORT_RETRY_REQUESTED', entity_type: 'Import', entity_id: importId, new_value: { previousStatus: 'FAILED', status: 'PROCESSING' } } });
      return { conflict: false } as const;
    });

    if (result.conflict) return NextResponse.json({ error: 'Only FAILED imports can be retried; the import may already be processing or committed' }, { status: 409 });

    try {
      const processingResult = await processImport(importId, { actorId: user.id });
      await prisma.auditLog.create({ data: { user_id: user.id, action: 'IMPORT_RETRY_COMPLETED', entity_type: 'Import', entity_id: importId, new_value: { status: 'READY_FOR_REVIEW', totalRows: processingResult.totalRows } } });
      return NextResponse.json({ status: 'READY_FOR_REVIEW', importId, result: processingResult }, { status: 200 });
    } catch (error) {
      await prisma.auditLog.create({ data: { user_id: user.id, action: 'IMPORT_RETRY_FAILED', entity_type: 'Import', entity_id: importId, new_value: { status: 'FAILED' } } }).catch(() => undefined);
      return NextResponse.json({ error: 'Import retry failed' }, { status: 500 });
    }
  } catch (error) {
    console.error('Import retry error:', error);
    return NextResponse.json({ error: 'Unable to retry import' }, { status: 500 });
  }
}
