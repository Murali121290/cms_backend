import { useState } from 'react';

/** Element tree of an XML source, by line, for the XML editors' "Document Outline" panel. */
export interface OutlineItem {
  tagName: string;
  line: number;
  children: OutlineItem[];
}

const INLINE_TAGS = ['strong', 'em', 'italic', 'bold', 'sub', 'sup', 'xref', 'link', 'mml:math', 'mml:mrow', 'tab'];

export const parseXmlOutline = (xml: string | null): OutlineItem[] => {
  if (!xml) return [];
  const outline: OutlineItem[] = [];
  const lines = xml.split('\n');
  const stack: OutlineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const tagRegex = /<(\/)?([a-zA-Z0-9_\-]+)(?:\s+[^>]*)*(\/)?>/g;
    let match;
    while ((match = tagRegex.exec(lineText)) !== null) {
      const isClosing = !!match[1];
      const tagName = match[2];
      const isSelfClosing = !!match[3];

      if (tagName.startsWith('?') || tagName.startsWith('!')) continue;
      if (INLINE_TAGS.includes(tagName.toLowerCase())) continue;

      if (isClosing) {
        stack.pop();
      } else {
        const item: OutlineItem = { tagName, line: i + 1, children: [] };
        if (stack.length === 0) {
          outline.push(item);
        } else {
          stack[stack.length - 1].children.push(item);
        }
        if (!isSelfClosing) {
          stack.push(item);
        }
      }
    }
  }
  return outline;
};

export function OutlineNode({ node, onSelect }: { node: OutlineItem; onSelect: (line: number) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div className="pl-3 font-sans text-xs select-none">
      <div className="flex items-center py-1 hover:bg-gray-100 rounded cursor-pointer group">
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 mr-1"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 mr-1" />
        )}
        <span
          onClick={() => onSelect(node.line)}
          className="text-blue-600 hover:underline font-mono"
        >
          &lt;{node.tagName}&gt;
        </span>
        <span className="text-[10px] text-gray-400 ml-auto pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
          L{node.line}
        </span>
      </div>
      {hasChildren && expanded && (
        <div className="border-l border-gray-200 ml-2">
          {node.children.map((child, idx) => (
            <OutlineNode key={idx} node={child} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
