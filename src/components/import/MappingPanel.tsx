'use client';

import { useEffect, useMemo, useState } from 'react';
import MappingEditor from './MappingEditor';
import type { HeaderMappingResult, ImportMappingTemplate } from '../../lib/import/mapping';

type MappingPanelProps = {
  file: File | null;
  template?: ImportMappingTemplate;
  onMappingChange?: (results: HeaderMappingResult[]) => void;
};

export default function MappingPanel({ file, template, onMappingChange }: MappingPanelProps) {
  const [previewResults, setPreviewResults] = useState<HeaderMappingResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewResults([]);
      return;
    }

    const fetchPreview = async () => {
      setLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      if (template) {
        formData.append('mapping_template', JSON.stringify(template));
      }

      try {
        const response = await fetch('/api/import-mapping', {
          method: 'POST',
          body: formData,
        });

        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error || 'Unable to preview mappings');
          setPreviewResults([]);
          return;
        }

        setPreviewResults(payload.preview.mappingResults || []);
      } catch (err) {
        setError('Unable to preview mappings.');
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [file, template]);

  const handleResultsChange = (results: HeaderMappingResult[]) => {
    setPreviewResults(results);
    onMappingChange?.(results);
  };

  const unmappedCount = useMemo(
    () => previewResults.filter((result) => result.status !== 'AUTO_MAPPED').length,
    [previewResults]
  );

  return (
    <div className="mapping-panel">
      <div className="mapping-status-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2>Header Mapping</h2>
            <p>
              Mappings are detected from known aliases. Review ambiguous and unmapped headers before confirming.
            </p>
          </div>
          <div className="mapping-count">
            {loading ? 'Detecting headers…' : `${unmappedCount} fields require review`}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mapping-error">
          {error}
        </div>
      ) : null}

      {previewResults.length > 0 ? (
        <MappingEditor initialResults={previewResults} onChange={handleResultsChange} />
      ) : (
        <div className="mapping-empty">
          Upload a file to review detected header mappings.
        </div>
      )}
    </div>
  );
}
