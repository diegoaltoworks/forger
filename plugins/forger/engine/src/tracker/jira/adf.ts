export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDoc extends AdfNode {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** The nodes the markdown conversion writes; a document it writes holds no other. */
export const WRITTEN_NODES = [
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'rule',
  'hardBreak',
  'text',
] as const;

export const WRITTEN_MARKS = ['code', 'strong', 'em', 'link'] as const;
