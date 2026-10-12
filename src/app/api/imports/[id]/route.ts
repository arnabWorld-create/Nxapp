import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getUserById, userHasPermission, getStorageKey } from '../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../lib/auth';
import { storage } from '../../../../lib/storage';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: importId } = await params;
    const userId = await resolveUserIdFromRequest(request);
    const user = userId ? await getUserById(userId) : null;
    if (!userId || !user) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    if (!userHasPermission(user, 'upload_import')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });

    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.import.findUnique({ where: { id: importId }, include: { statement: { select: { status: true } } } });
      if (!record) return { error: 'Import not found', status: 404 } as const;
      if (record.uploaded_by !== user.id && user.role?.name !== 'ADMIN') {
        return { error: 'Access denied', status: 403 } as const;
      }
      if (record.status === 'PROCESSING') {
        return { error: 'Wait for processing to finish before deleting this import', status: 409 } as const;
      }
      const hasStatementData = record.status === 'COMMITTED' || Boolean(record.statement_id);
      if (hasStatementData && !userHasPermission(user, 'manage_statement_approval')) {
        return { error: 'Permission denied: manage_statement_approval required to delete committed sales data', status: 403 } as const;
      }

      const importRows = await tx.importRow.findMany({
        where: { import_id: importId },
        select: { id: true },
      });
      let statementRows: Array<{ id: string }> = [];

      if (record.statement_id) {
        const otherImport = await tx.import.findFirst({
          where: { statement_id: record.statement_id, id: { not: importId } },
          select: { id: true },
        });
        if (otherImport) {
          return { error: 'This statement is shared by another import and cannot be deleted from here', status: 409 } as const;
        }

        statementRows = await tx.statementRow.findMany({
          where: { statement_id: record.statement_id },
          select: { id: true },
        });
        await tx.statementRow.deleteMany({ where: { statement_id: record.statement_id } });
      }

      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { entity_type: 'Import', entity_id: importId },
            ...(importRows.length ? [{ entity_type: 'ImportRow', entity_id: { in: importRows.map((row) => row.id) } }] : []),
            ...(record.statement_id ? [{ entity_type: 'Statement', entity_id: record.statement_id }] : []),
            ...(statementRows.length ? [{ entity_type: 'StatementRow', entity_id: { in: statementRows.map((row) => row.id) } }] : []),
          ],
        },
      });
      await tx.importRow.deleteMany({ where: { import_id: importId } });
      await tx.import.delete({ where: { id: importId } });
      if (record.statement_id) await tx.statement.delete({ where: { id: record.statement_id } });

      await tx.auditLog.create({
        data: {
          user_id: user.id,
          action: 'IMPORT_DELETED',
          entity_type: 'Import',
          entity_id: importId,
          old_value: { file_name: record.file_name, status: record.status, statement_id: record.statement_id },
          reason: record.statement_id ? 'Import and linked statement deleted by owner' : 'Import deleted by owner',
        },
      });

      return {
        fileName: record.file_name,
        fileSha256: record.file_sha256,
        statementDeleted: Boolean(record.statement_id),
      } as const;
    }, { maxWait: 10000, timeout: 30000 });

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

    let storageWarning: string | null = null;
    if (result.fileSha256) {
      const extension = path.extname(result.fileName);
      const remainingReference = await prisma.import.findFirst({
        where: { file_sha256: result.fileSha256, file_name: { endsWith: extension } },
        select: { id: true },
      });
      if (!remainingReference) {
        try {
          await storage.delete(getStorageKey(result.fileSha256, extension));
        } catch {
          storageWarning = 'Import records were deleted, but the stored file could not be removed.';
        }
      }
    }

    return NextResponse.json({ deleted: true, ...result, storageWarning }, { status: 200 });
  } catch (error) {
    console.error('Import deletion error:', error);
    return NextResponse.json({ error: 'Unable to delete import' }, { status: 500 });
  }
}