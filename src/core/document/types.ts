/**
 * The native Folio document model.
 * Keep this layer independent from Preact and browser rendering APIs.
 */

export const FOLIO_FORMAT = 'folio-project' as const;
export const FOLIO_FORMAT_VERSION = 1 as const;

export interface NodeBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
}

export interface RectNode extends NodeBase {
  type: 'rect';
  style: ShapeStyle;
}

export interface EllipseNode extends NodeBase {
  type: 'ellipse';
  style: ShapeStyle;
}

export interface TextNode extends NodeBase {
  type: 'text';
  text: string;
  style: {
    fill: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    letterSpacing: number;
    lineHeight: number;
  };
}

export type DesignNode = RectNode | EllipseNode | TextNode;

export interface FolioDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  nodes: DesignNode[];
}

export interface FolioProject {
  format: typeof FOLIO_FORMAT;
  formatVersion: typeof FOLIO_FORMAT_VERSION;
  appVersion: string;
  metadata: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  document: FolioDocument;
}
