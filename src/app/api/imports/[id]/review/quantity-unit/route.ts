import { NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../../lib/auth';
import { normalizeQuantityUnit } from '../../../../../../lib/import/validation/unit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'review_import')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });

    const body = await request.json();
    const unit = normalizeQuantityUnit(body?.unit);
    if (!unit || body?.confirmed !== true) {
      return NextResponse.json({ error: 'A quantity unit and explicit confirmation are required' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const importRecord = await tx.import.findUnique({ where: { id }, select: { id: true, uploaded_by: true } });
      if (!importRecord) return { error: 'Import not found', status: 404 } as const;
      if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') return { error: 'Access denied', status: 403 } as const;

      const rows = await tx.importRow.findMany({
        where: { import_id: id, row_type: 'DATA_ROW' },
        select: { id: true, parsed_data_json: true, validation_status: true },
      });
      let affectedRows = 0;
      for (const row of rows) {
        const parsed = (row.parsed_data_json ?? {}) as any;
        const normalizedData = { ...(parsed.normalizedData ?? {}) };
        if (normalizedData.quantity_unit) continue;
        const issues = Array.isArray(parsed.validationIssues) ? parsed.validationIssues.filter((issue: any) => issue.code !== 'MISSING_QUANTITY_UNIT') : [];
        normalizedData.quantity_unit = unit;
        const nextStatus = issues.some((issue: any) => issue.severity === 'ERROR') ? 'INVALID' : issues.some((issue: any) => issue.severity === 'WARNING') ? 'REVIEW_REQUIRED' : 'VALID';
        await tx.importRow.update({ where: { id: row.id }, data: { parsed_data_json: { ...parsed, normalizedData, validationIssues: issues }, validation_status: nextStatus } });
        affectedRows++;
      }
      await tx.import.update({ where: { id }, data: { default_quantity_unit: unit, default_quantity_unit_confirmed: true, default_quantity_unit_confirmed_by: user.id, default_quantity_unit_confirmed_at: new Date() } });
      await tx.auditLog.create({ data: { user_id: user.id, action: 'IMPORT_DEFAULT_QUANTITY_UNIT_CONFIRMED', entity_type: 'Import', entity_id: id, new_value: { unit, affectedRows } } });
      return { affectedRows, status: 200 } as const;
    });

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Quantity unit decision error:', error);
    return NextResponse.json({ error: 'Unable to apply quantity unit' }, { status: 500 });
  }
}