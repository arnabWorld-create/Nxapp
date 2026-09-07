/**
 * GET /api/imports/[id]/commit-preflight
 *
 * Read-only commit preflight. Returns which rows of an Import are eligible for
 * commit and which rows block/review. Does NOT create StatementRows, does NOT
 * modify Import status, and does NOT write audit logs. Safe to call repeatedly
 * (idempotent, side-effect free).
 *
 * Auth:
 *  - Session cookie OR x-user-id header required (401 if missing)
 *  - user must have the `commit_import` permission (403 otherwise)
 *  - user must own the import OR be an ADMIN (403 otherwise)
 *  - 404 if the import does not exist
 */

import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';
import {
  getCommitPreflight,
  ImportNotFoundError,
} from '../../../../../lib/import/commit-preflight';

export async function GET(
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

    // Ownership: owner or ADMIN role may access (admin is a Role, not a permission)
    if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    try {
      const preflight = await getCommitPreflight(importId);
      return NextResponse.json(preflight, { status: 200 });
    } catch (err) {
      if (err instanceof ImportNotFoundError) {
        return NextResponse.json({ error: 'Import not found' }, { status: 404 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Commit preflight error:', error);
    return NextResponse.json({ error: 'Unable to compute commit preflight' }, { status: 500 });
  }
}
