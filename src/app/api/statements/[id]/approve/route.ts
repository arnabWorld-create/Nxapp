import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';
import {
  approveStatement,
  StatementApprovalConflictError,
  StatementApprovalError,
  StatementNotFoundError,
} from '../../../../../lib/statements/approval';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });

    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 403 });
    if (!userHasPermission(user, 'manage_statement_approval')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const statement = await approveStatement({ statementId: id, userId, note: body?.note });
    return NextResponse.json({
      statement: {
        id: statement.id,
        status: statement.status,
        approved_by: statement.approved_by_user,
        approved_at: statement.approved_at?.toISOString() ?? null,
        approval_note: statement.approval_note,
      },
    }, { status: 200 });
  } catch (error) {
    if (error instanceof StatementNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof StatementApprovalConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof StatementApprovalError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Statement approval error:', error);
    return NextResponse.json({ error: 'Unable to approve statement' }, { status: 500 });
  }
}
