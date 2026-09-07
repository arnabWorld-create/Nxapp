import prisma from '../prisma';

export class StatementApprovalError extends Error {}
export class StatementNotFoundError extends StatementApprovalError {}
export class StatementApprovalConflictError extends StatementApprovalError {}

export async function approveStatement(input: {
  statementId: string;
  userId: string;
  note?: string | null;
}) {
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) {
    throw new StatementApprovalError('Approval note must be 1000 characters or fewer');
  }

  return prisma.$transaction(async (tx) => {
    const statement = await tx.statement.findUnique({
      where: { id: input.statementId },
      select: { id: true, status: true },
    });

    if (!statement) throw new StatementNotFoundError('Statement not found');
    if (statement.status !== 'READY_FOR_REVIEW') {
      throw new StatementApprovalConflictError('Only statements ready for review can be approved');
    }

    const approvedAt = new Date();
    const updated = await tx.statement.update({
      where: { id: input.statementId },
      data: {
        status: 'APPROVED',
        approved_by: input.userId,
        approved_at: approvedAt,
        approval_note: note,
      },
      include: {
        approved_by_user: { select: { id: true, name: true, email: true } },
      },
    });

    await tx.auditLog.create({
      data: {
        user_id: input.userId,
        action: 'STATEMENT_APPROVED',
        entity_type: 'Statement',
        entity_id: input.statementId,
        old_value: { status: 'READY_FOR_REVIEW' },
        new_value: { status: 'APPROVED', approvedAt: approvedAt.toISOString(), note },
        reason: note,
      },
    });

    return updated;
  });
}
