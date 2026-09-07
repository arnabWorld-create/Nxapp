import { NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../../lib/auth';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'review_import')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const body = await request.json();
    if (body?.acknowledged !== true) return NextResponse.json({ error: 'Explicit acknowledgement is required' }, { status: 400 });

    const importRecord = await prisma.import.findUnique({ where: { id }, select: { id: true, uploaded_by: true } });
    if (!importRecord) return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    await prisma.$transaction([
      prisma.import.update({ where: { id }, data: { summary_rows_acknowledged: true, summary_rows_acknowledged_by: user.id, summary_rows_acknowledged_at: new Date() } }),
      prisma.auditLog.create({ data: { user_id: user.id, action: 'IMPORT_SUMMARY_ROWS_ACKNOWLEDGED', entity_type: 'Import', entity_id: id, new_value: { acknowledged: true } } }),
    ]);
    return NextResponse.json({ acknowledged: true }, { status: 200 });
  } catch (error) {
    console.error('Summary acknowledgement error:', error);
    return NextResponse.json({ error: 'Unable to acknowledge summary rows' }, { status: 500 });
  }
}