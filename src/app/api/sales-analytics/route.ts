import { NextResponse } from 'next/server';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { getSalesAnalytics } from '../../../lib/reporting/sales-analytics';

function filters(request: Request) {
  const url = new URL(request.url);
  return {
    salespersonId: url.searchParams.get('salesperson_id')?.trim() || undefined,
    startDate: url.searchParams.get('start_date')?.trim() || undefined,
    endDate: url.searchParams.get('end_date')?.trim() || undefined,
    divisionId: url.searchParams.get('division_id')?.trim() || undefined,
    distributorId: url.searchParams.get('distributor_id')?.trim() || undefined,
    productSearch: url.searchParams.get('product_search')?.trim() || undefined,
  };
}

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 403 });
    if (!userHasPermission(user, 'view_statement')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const canSelectSalesperson = user.role.name === 'ADMIN' || user.role.name === 'MANAGER';
    return NextResponse.json(await getSalesAnalytics({ authenticatedUserId: user.id, canSelectSalesperson, filters: filters(request) }));
  } catch (error) {
    if (error instanceof Error && /must be a valid date/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Sales analytics error:', error);
    return NextResponse.json({ error: 'Unable to retrieve sales analytics' }, { status: 500 });
  }
}
