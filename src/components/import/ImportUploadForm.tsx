'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MappingPanel from './MappingPanel';
import type { HeaderMappingResult } from '../../lib/import/mapping';
import { isAllowedImportExtension } from '../../lib/import/file-types';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export default function ImportUploadForm() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploadedImportId, setUploadedImportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mappingResults, setMappingResults] = useState<HeaderMappingResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelection = useCallback((file: File | null) => {
    setStatusMessage(null);
    setErrorMessage(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    setUploadedImportId(null);

    if (!isAllowedImportExtension(file.name)) {
      setErrorMessage('Only .csv, .xls, and .xlsx files are supported');
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMessage('File size must be 15MB or smaller');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    handleFileSelection(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    handleFileSelection(file);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleMappingChange = (results: HeaderMappingResult[]) => {
    setMappingResults(results);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    if (!selectedFile) {
      setErrorMessage('Please select a file to upload');
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(payload.error || 'Upload failed');
        return;
      }

      setStatusMessage(`Import uploaded successfully. Import ID: ${payload.import.id}`);
      setUploadedImportId(payload.import.id);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      setErrorMessage('Unable to upload file. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleIdleButtonClick = () => {
    if (uploadedImportId) {
      router.push(`/import/${uploadedImportId}/review`);
      return;
    }

    fileInputRef.current?.click();
  };

  return (
    <div className="import-workspace">
      <div className="import-workflow" aria-label="Import workflow"><span className="is-current"><b>01</b>Upload</span><i /> <span className={selectedFile ? 'is-current' : ''}><b>02</b>Parse</span><i /> <span><b>03</b>Validate</span><i /> <span><b>04</b>Map</span><i /> <span><b>05</b>Review</span></div>
      <form className="import-card" onSubmit={handleSubmit}>
        <div className="import-card-heading"><div><p className="eyebrow">Source intake</p><h2>Upload your statement</h2><p>Select the source file you want to prepare for review.</p></div><span className="import-ready-badge">{isSubmitting ? 'Processing' : selectedFile ? 'Ready to process' : 'Waiting for file'}</span></div>
        <div
          className={`import-dropzone ${selectedFile ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="upload-mark" aria-hidden="true">↑</span>
          <strong>{selectedFile ? 'Statement selected' : 'Drag & drop your statement here'}</strong>
          <span>{selectedFile ? 'Ready to process when you are.' : 'or choose a file from your device'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            onChange={handleInputChange}
            className="import-file-input"
          />
          {selectedFile ? (
            <div className="selected-file" onClick={(event) => event.stopPropagation()}><div><strong>{selectedFile.name}</strong><span>{selectedFile.name.split('.').pop()?.toUpperCase()} · {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span></div><button type="button" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="file-remove">Remove</button></div>
          ) : null}
          {!selectedFile && <span className="import-format-note">XLSX, XLS, or CSV · Max 15 MB</span>}
        </div>

        <div className="mapping-status"><MappingPanel file={selectedFile} onMappingChange={handleMappingChange} /></div>

        {errorMessage ? <div className="import-message error-state">{errorMessage}</div> : null}
        {statusMessage ? (
          <div className="import-message success-state" role="status">{statusMessage}</div>
        ) : null}

        <button
          type={selectedFile ? 'submit' : 'button'}
          onClick={selectedFile ? undefined : handleIdleButtonClick}
          disabled={isSubmitting}
          className="primary-action import-submit"
        >
          {isSubmitting ? 'Uploading…' : selectedFile ? 'Upload & Process Statement' : uploadedImportId ? 'Go to Review' : 'Choose a statement file'}
        </button>
      </form>
    </div>
  );
}
