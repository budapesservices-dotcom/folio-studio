import type { FolioDocument } from './types';

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => structurallyEqual(item, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(rightRecord, key) &&
    structurallyEqual(leftRecord[key], rightRecord[key]));
}

/** Compares JSON-shaped Folio documents without depending on key order or reference identity. */
export function areDocumentsStructurallyEqual(left: FolioDocument, right: FolioDocument): boolean {
  return structurallyEqual(left, right);
}
