import type {
  CodeMappingCategory,
  CodeModuleLanguage,
  DesignNode,
  SemanticHtmlTag,
} from '../../core/document/types';

export type CodeOutputTarget = 'html-css' | 'react';

export interface CodeMappingEntry {
  nodeId: string;
  nodeName: string;
  pageId?: string;
  componentId?: string;
  category: CodeMappingCategory;
  startLine: number;
  endLine: number;
  selector?: string;
}

export interface CompiledCodeFile {
  id: string;
  path: string;
  language: CodeModuleLanguage;
  category: CodeMappingCategory;
  readOnly: boolean;
  content: string;
  pageId?: string;
  componentId?: string;
  targetNodeId?: string;
  moduleId?: string;
  description: string;
  mappings: CodeMappingEntry[];
}

export interface CompiledProjectSummary {
  totalFiles: number;
  generatedCount: number;
  mappedCount: number;
  customCount: number;
  extensionCount: number;
  mappedNodeCount: number;
}

export interface CompiledProjectOutput {
  target: CodeOutputTarget;
  activePageId: string;
  activeThemeId: string;
  files: CompiledCodeFile[];
  summary: CompiledProjectSummary;
}

export interface CodegenOptions {
  target?: CodeOutputTarget;
  pageId?: string;
  themeId?: string;
  includeAllPages?: boolean;
}

export interface MappedNodeEditPatch {
  text?: string;
  semanticTag?: SemanticHtmlTag | '';
  ariaLabel?: string;
  href?: string;
  fill?: string;
  radius?: number;
  gap?: number;
  visible?: boolean;
}

export type MappedEditResult =
  | {
      status: 'applied';
      node: DesignNode;
      changedFields: string[];
      summary: string;
    }
  | {
      status: 'no-op';
      node: DesignNode;
      reason: string;
    }
  | {
      status: 'unsupported';
      reason: string;
    };
