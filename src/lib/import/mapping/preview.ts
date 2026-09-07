import { parseImportFile } from '../parser/parser';
import { buildHeaderMappingResults, validateTemplate, HeaderMappingResult, ImportMappingTemplate } from './index';

export async function previewHeaderMappings(file: File, template?: ImportMappingTemplate): Promise<{
  headers: string[];
  mappingResults: HeaderMappingResult[];
}> {
  if (template && !validateTemplate(template)) {
    throw new Error('Invalid mapping template');
  }

  const parsed = await parseImportFile(file);
  const results = buildHeaderMappingResults(parsed.headers, template);

  return {
    headers: parsed.headers,
    mappingResults: results,
  };
}
