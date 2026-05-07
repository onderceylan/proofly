const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIALOG',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HGROUP',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
]);

interface TextSegment {
  text: string;
  node?: Text;
}

function collectSegments(element: HTMLElement): TextSegment[] {
  const segments: TextSegment[] = [];
  let needsNewline = false;

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent || '';
      if (content.length === 0) {
        return;
      }
      if (needsNewline && segments.length > 0) {
        segments.push({ text: '\n' });
      }
      needsNewline = false;
      segments.push({ text: content, node: node as Text });
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const el = node as HTMLElement;

    if (el.tagName === 'BR') {
      segments.push({ text: '\n' });
      needsNewline = false;
      return;
    }

    const isBlock = BLOCK_TAGS.has(el.tagName);
    if (isBlock) {
      needsNewline = true;
    }

    for (const child of el.childNodes) {
      walk(child);
    }

    if (isBlock) {
      needsNewline = true;
    }
  }

  if (!element.childNodes) {
    const text = element.textContent || '';
    if (text.length > 0) {
      segments.push({ text });
    }
    return segments;
  }

  for (const child of element.childNodes) {
    walk(child);
  }

  return segments;
}

export function extractContentEditableText(element: HTMLElement): string {
  return collectSegments(element)
    .map((s) => s.text)
    .join('');
}

export function resolveContentEditableOffset(
  element: HTMLElement,
  targetOffset: number
): { node: Text; offset: number } | null {
  const segments = collectSegments(element);
  let pos = 0;
  let lastTextNode: Text | null = null;

  for (const seg of segments) {
    const segEnd = pos + seg.text.length;

    if (seg.node) {
      if (targetOffset >= pos && targetOffset < segEnd) {
        return { node: seg.node, offset: targetOffset - pos };
      }
      if (targetOffset === segEnd) {
        return { node: seg.node, offset: seg.node.length };
      }
      lastTextNode = seg.node;
    } else if (targetOffset >= pos && targetOffset < segEnd && lastTextNode) {
      return { node: lastTextNode, offset: lastTextNode.length };
    }

    pos = segEnd;
  }

  if (lastTextNode && targetOffset === pos) {
    return { node: lastTextNode, offset: lastTextNode.length };
  }

  return null;
}
