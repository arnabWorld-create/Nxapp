import { NextResponse } from 'next/server';
import { previewHeaderMappings } from '../../../lib/import/mapping/preview';
import { validateTemplate } from '../../../lib/import/mapping';

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Content-Type must be multipart/form-data' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const template = formData.get('mapping_template');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'A file upload is required' }, { status: 400 });
    }

    const parsedTemplate = typeof template === 'string' ? JSON.parse(template) : undefined;
    if (parsedTemplate && !validateTemplate(parsedTemplate)) {
      return NextResponse.json({ error: 'Invalid mapping template' }, { status: 400 });
    }

    const preview = await previewHeaderMappings(file, parsedTemplate);
    return NextResponse.json({ preview }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Unable to generate preview' }, { status: 500 });
  }
}
