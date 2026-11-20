import { areDocumentsStructurallyEqual } from '../core/document/equality';
import type { ComponentDefinition, FolioDocument } from '../core/document/types';
import type { EditorAction } from './editorReducer';

/**
 * Returns the canonical update only when Component Canvas content has actually changed.
 * The timestamp is generated after the semantic equality guard, so opening a master is a
 * true no-op for the Main Canvas project and its history.
 */
export function createComponentCanvasSyncAction(
  master: ComponentDefinition | undefined,
  editedDocument: FolioDocument,
): Extract<EditorAction, { type: 'update-component' }> | null {
  if (!master || areDocumentsStructurallyEqual(master.document, editedDocument)) return null;
  return {
    type: 'update-component',
    component: {
      ...master,
      document: editedDocument,
      updatedAt: new Date().toISOString(),
    },
  };
}
