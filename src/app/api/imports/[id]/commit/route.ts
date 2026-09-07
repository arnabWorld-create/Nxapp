/**
 * POST /api/imports/[id]/commit
 *
 * Transactional commit of a fully-eligible Import into permanent Statement +
 * StatementRow records. Read-only preflight gate + atomic transaction.
 *
 * Request body:
 *   { "period_start_date": "YYYY-MM-DD", "period_end_date": "YYYY-MM-DD" }
 *
 * Auth:
 *  - x-user-id header required (401 if missing)
 *  - user must have the `commit_import` permission (403 otherwise)
 *  - user must own the import OR be an ADMIN (403 otherwise)
 *  - 404 if the import does not exist
 *
 * Responses:
 *  - 200 success
 *  - 400 invalid period
 *  - 409 commit blocked / already committed / concurrent conflict
 *  - 401 / 403 / 404 / 500
 */

import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';
import { Prisma } from '@prisma/client';
import {
  commitImport,
  CommitPreflightBlockedError,
  ImportAlreadyCommittedError,
  InvalidCommitPeriodError,
  CommitImportNotFoundError,
  InvalidDistributorError,
} from '../../../../../lib/import/commit';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: importId } = await params;

    const userId = await resolveUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 });
    }

    if (!userHasPermission(user, 'commit_import')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const importRecord = await prisma.import.findUnique({
      where: { id: importId },
      select: { uploaded_by: true },
    });

    if (!importRecord) {
      return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    }

    if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    let body: { period_start_date?: unknown; period_end_date?: unknown; distributor_id?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    try {
      const result = await commitImport({
        importId,
        userId: user.id,
        periodStartDate: String(body.period_start_date ?? ''),
        periodEndDate: String(body.period_end_date ?? ''),
        distributorId: String(body.distributor_id ?? ''),
      });

      return NextResponse.json(
        {
          success: true,
          importId: result.importId,
          statementId: result.statementId,
          committedRows: result.committedRows,
          status: result.status,
        },
        { status: 200 }
      );
    } catch (err) {
      if (err instanceof InvalidCommitPeriodError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof InvalidDistributorError) {
        return NextResponse.json({ error: err.message }, { status: err.message.includes('Inactive') ? 409 : 400 });
      }
      if (err instanceof CommitPreflightBlockedError) {
        return NextResponse.json(
          { error: 'Commit blocked', blockers: err.blockers },
          { status: 409 }
        );
      }
      if (err instanceof ImportAlreadyCommittedError) {
        return NextResponse.json({ error: 'Import already committed' }, { status: 409 });
      }
      if (err instanceof CommitImportNotFoundError) {
        return NextResponse.json({ error: 'Import not found' }, { status: 404 });
      }
      // Concurrent commit conflict (unique violation on statement_row.import_row_id)
      // or serialization failure under SERIALIZABLE isolation.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2002' || err.code === 'P2034')
      ) {
        return NextResponse.json(
          { error: 'Commit conflict: import was committed concurrently' },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error('Commit error:', error);
    return NextResponse.json({ error: 'Unable to commit import' }, { status: 500 });
  }
}
