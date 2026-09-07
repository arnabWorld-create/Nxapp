import { NextResponse } from 'next/server';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../lib/auth';
import { getStatementReport } from '../../../../lib/reporting/statements';

function filtersFromRequest(request: Request) {
  const url = new URL(request.url);
  return { startDate: url.searchParams.get('start_date')?.trim() || undefined, endDate: url.searchParams.get('end_date')?.trim() || undefined, divisionId: url.searchParams.get('division_id')?.trim() || undefined, productSearch: url.searchParams.get('product_search')?.trim() || undefined };
}

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 403 });
    if (!userHasPermission(user, 'view_statement')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const canViewAll = user.role.name === 'ADMIN' || user.role.name === 'MANAGER';
    return NextResponse.json(await getStatementReport({ ...filtersFromRequest(request), salespersonId: canViewAll ? undefined : user.id }));
  } catch (error) {
    console.error('Statement report error:', error);
    return NextResponse.json({ error: 'Unable to retrieve statement report' }, { status: 500 });
  }
}