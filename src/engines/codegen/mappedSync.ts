import type { DesignNode, SemanticHtmlTag } from '../../core/document/types';
import { SEMANTIC_HTML_TAGS } from '../../core/document/validation';
import { sanitizeHref } from './sanitize';
import type { MappedEditResult, MappedNodeEditPatch } from './types';

const ALLOWED_TAGS = new Set<string>(SEMANTIC_HTML_TAGS);

/**
 * Deterministic Code -> AST synchronization for Mapped Code properties.
 *
 * Per FOLIO Blueprint §7 (Designer-Developer Integration Rules):
 * - Updates only explicitly supported mapped properties (text content,
 *   semantic HTML tag, accessible label, validated link href, fill color,
 *   corner radius, Auto-Layout gap, visibility).
 * - Reports honest `{ status: 'unsupported', reason }` when a developer
 *   submits an invalid URL scheme, unsupported tag, or structural edit outside
 *   the mapped contract, preserving AST integrity without silent data loss.
 */
export function applyMappedNodeEdit(
  node: DesignNode,
  patch: MappedNodeEditPatch,
): MappedEditResult {
  if (node.locked) {
    return {
      status: 'unsupported',
      reason: `Node "${node.name}" is locked. Unlock it before applying mapped code changes.`,
    };
  }

  let next: DesignNode = { ...node };
  const changedFields: string[] = [];

  if (patch.semanticTag !== undefined) {
    if (patch.semanticTag === '') {
      if (next.semanticTag !== undefined) {
        const copy = { ...next };
        delete copy.semanticTag;
        next = copy;
        changedFields.push('semanticTag');
      }
    } else if (!ALLOWED_TAGS.has(patch.semanticTag)) {
      return {
        status: 'unsupported',
        reason: `Unsupported semantic HTML tag "<${patch.semanticTag}>". Use a standard Folio semantic tag or create a Custom/Extension module.`,
      };
    } else if (next.semanticTag !== patch.semanticTag) {
      next = { ...next, semanticTag: patch.semanticTag as SemanticHtmlTag };
      changedFields.push('semanticTag');
    }
  }

  if (patch.ariaLabel !== undefined) {
    const trimmed = patch.ariaLabel.trim();
    if (!trimmed) {
      if (next.ariaLabel !== undefined) {
        const copy = { ...next };
        delete copy.ariaLabel;
        next = copy;
        changedFields.push('ariaLabel');
      }
    } else if (next.ariaLabel !== trimmed) {
      next = { ...next, ariaLabel: trimmed };
      changedFields.push('ariaLabel');
    }
  }

  if (patch.href !== undefined) {
    const trimmed = patch.href.trim();
    if (!trimmed) {
      if (next.href !== undefined) {
        const copy = { ...next };
        delete copy.href;
        next = copy;
        changedFields.push('href');
      }
    } else {
      const safe = sanitizeHref(trimmed);
      if (!safe) {
        return {
          status: 'unsupported',
          reason: 'Unsafe or invalid link URL. Only http(s), mailto, root-relative (/), or anchor (#) links are allowed.',
        };
      }
      if (next.href !== safe) {
        next = { ...next, href: safe };
        changedFields.push('href');
      }
    }
  }

  if (patch.text !== undefined) {
    if (next.type !== 'text') {
      return {
        status: 'unsupported',
        reason: `Direct text mapping applies to Text nodes. "${node.name}" is a ${node.type} node.`,
      };
    }
    if (next.text !== patch.text) {
      next = { ...next, text: patch.text };
      changedFields.push('text');
    }
  }

  if (patch.fill !== undefined) {
    const cleanFill = patch.fill.trim();
    if (!cleanFill) {
      return { status: 'unsupported', reason: 'Fill color cannot be empty.' };
    }
    if (next.type === 'rect' || next.type === 'ellipse' || next.type === 'frame' || next.type === 'path' || next.type === 'text') {
      if (next.style.fill !== cleanFill) {
        next = { ...next, style: { ...next.style, fill: cleanFill } } as DesignNode;
        changedFields.push('fill');
      }
    } else {
      return {
        status: 'unsupported',
        reason: `Node type "${next.type}" does not support direct mapped fill color.`,
      };
    }
  }

  if (patch.radius !== undefined) {
    if (!Number.isFinite(patch.radius) || patch.radius < 0) {
      return { status: 'unsupported', reason: 'Corner radius must be a non-negative number.' };
    }
    if (next.type === 'rect' || next.type === 'frame') {
      const rounded = Math.round(patch.radius * 100) / 100;
      if (next.style.radius !== rounded) {
        next = { ...next, style: { ...next.style, radius: rounded } } as DesignNode;
        changedFields.push('radius');
      }
    } else {
      return {
        status: 'unsupported',
        reason: `Corner radius mapping applies only to Rectangle and Frame nodes.`,
      };
    }
  }

  if (patch.gap !== undefined) {
    if (!Number.isFinite(patch.gap) || patch.gap < 0) {
      return { status: 'unsupported', reason: 'Auto-Layout gap must be a non-negative number.' };
    }
    if (!next.layout || next.layout.mode === 'none') {
      return {
        status: 'unsupported',
        reason: `Node "${node.name}" does not have Auto-Layout enabled.`,
      };
    }
    const rounded = Math.round(patch.gap * 100) / 100;
    if (next.layout.gap !== rounded) {
      next = { ...next, layout: { ...next.layout, gap: rounded } };
      changedFields.push('gap');
    }
  }

  if (patch.visible !== undefined && next.visible !== patch.visible) {
    next = { ...next, visible: patch.visible };
    changedFields.push('visible');
  }

  if (changedFields.length === 0) {
    return {
      status: 'no-op',
      node,
      reason: 'Mapped code properties are already in sync with the AST node.',
    };
  }

  return {
    status: 'applied',
    node: next,
    changedFields,
    summary: `Synced ${changedFields.join(', ')} to "${next.name}".`,
  };
}
