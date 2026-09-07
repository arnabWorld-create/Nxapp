import { NextResponse } from 'next/server';
import { validateMappedRow } from '../../../lib/import/validation';

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 400 });
    }

    const body = await request.json();
    const { sourceRowNumber, rawData, mappingResults } = body ?? {};

    if (typeof sourceRowNumber !== 'number' || typeof rawData !== 'object' || rawData === null || !Array.isArray(mappingResults)) {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
    }

    const validated = validateMappedRow(sourceRowNumber, rawData, mappingResults);
    return NextResponse.json({ validated }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Unable to validate row' }, { status: 500 });
  }
}
