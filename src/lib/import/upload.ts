import path from 'path';
import crypto from 'crypto';
import prisma from '../prisma';
import { storage } from '../storage';
import { ALLOWED_IMPORT_EXTENSIONS, getNormalizedFileExtension } from './file-types';

export class AuthorizationError extends Error {}
export class ValidationError extends Error {}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function sanitizeFileName(fileName: string) {
  const baseName = path.basename((fileName ?? '').replace(/\\/g, '/'));
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safeName || 'upload-file';
}

export function getStorageKey(hash: string, extension: string) {
  return `imports/${hash}${extension}`;
}

function validateCsvContent(buffer: Buffer) {
  if (buffer.includes(0)) {
    throw new ValidationError('CSV file contains binary data');
  }

  const sample = buffer.slice(0, 2048).toString('utf8');
  if (!sample.includes('\n') && !sample.includes('\r')) {
    throw new ValidationError('CSV file does not contain a valid line separator');
  }
}

function validateFileSignature(buffer: Buffer, extension: string) {
  if (extension === '.xlsx') {
    if (!buffer.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new ValidationError('Excel .xlsx file signature is invalid');
    }
    return;
  }

  if (extension === '.xls') {
    if (!buffer.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      throw new ValidationError('Excel .xls file signature is invalid');
    }
    return;
  }

  if (extension === '.csv') {
    validateCsvContent(buffer);
    return;
  }

  throw new ValidationError('Unsupported file extension');
}

export async function getUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          role_permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  });
}

export function userHasPermission(user: Awaited<ReturnType<typeof getUserById>>, permissionName: string) {
  if (!user?.role?.role_permissions) {
    return false;
  }

  return user.role.role_permissions.some((rp) => rp.permission?.name === permissionName);
}

export async function processImportUpload(file: File, userId: string) {
  const fileName = sanitizeFileName(file.name);
  const extension = getNormalizedFileExtension(fileName);

  if (!ALLOWED_IMPORT_EXTENSIONS.includes(extension as (typeof ALLOWED_IMPORT_EXTENSIONS)[number])) {
    throw new ValidationError('Only .csv, .xls, and .xlsx files are supported');
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength === 0) {
    throw new ValidationError('Uploaded file is empty');
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`File exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }

  validateFileSignature(buffer, extension);

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const user = await getUserById(userId);
  if (!user) {
    throw new AuthorizationError('User not found');
  }

  if (!userHasPermission(user, 'upload_import')) {
    throw new AuthorizationError('User does not have upload permission');
  }

  const storedFileKey = getStorageKey(sha256, extension);
  await storage.put({ key: storedFileKey, body: buffer, contentType: file.type || extension });

  const importRecord = await prisma.import.create({
    data: {
      file_name: fileName,
      file_type: file.type || extension,
      file_sha256: sha256,
      status: 'UPLOADED',
      uploaded_by: user.id,
    },
  });

  return {
    importRecord,
    storedFileKey,
  };
}
