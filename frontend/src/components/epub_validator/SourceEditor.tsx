import { useMemo, useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import CodeMirror, { EditorView, keymap, Prec } from '@uiw/react-codemirror';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { xml } from '@codemirror/lang-xml';
import { search, findNext, findPrevious } from '@codemirror/search';
import { cn } from '@/utils/epubValidatorUtils';
import { FindReplacePanel } from './FindReplacePanel';
import { linter } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';

export interface LintError {
  line: number;
  message: string;
}

export interface SourceEditorRef {
  scrollToLine: (lineNum: number) => void;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  readOnly?: boolean;
  errors?: LintError[];
  onLogLineClick?: (lineNum: number) => void;
}

// XML tag auto-closer
const xmlAutoClose = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '>') return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const match = before.match(/<([a-zA-Z0-9_\-]+)(?:\s+[^>]*)*$/);
  if (match) {
    const tagName = match[1];
    if (before.endsWith('/') || before.includes('?') || before.includes('!')) {
      return false;
    }
    view.dispatch({
      changes: { from, to, insert: `></${tagName}>` },
      selection: { anchor: from + 1 }
    });
    return true;
  }
  return false;
});

// XML Formatter
export function formatXmlString(xmlStr: string): string {
  let formatted = '';
  let indent = 0;
  const tab = '  ';
  
  const cleanXml = xmlStr.replace(/>\s+</g, '><').trim();
  const reg = /(<[^>]+>)/g;
  const parts = cleanXml.split(reg);
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    
    if (part.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      formatted += tab.repeat(indent) + part + '\n';
    } else if (part.startsWith('<') && !part.endsWith('/>') && !part.startsWith('<?') && !part.startsWith('<!')) {
      formatted += tab.repeat(indent) + part + '\n';
      indent++;
    } else if (part.startsWith('<?') || part.startsWith('<!') || part.endsWith('/>')) {
      formatted += tab.repeat(indent) + part + '\n';
    } else {
      formatted += tab.repeat(indent) + part.trim() + '\n';
    }
  }
  
  return formatted.trim();
}

/**
 * Source editor built on CodeMirror 6 with a custom-styled Find/Replace panel.
 *
 * - Ctrl/Cmd+F   Open find
 * - Ctrl/Cmd+H   Open find + replace
 * - Enter        Find next
 * - Shift+Enter  Find previous
 * - Escape       Close panel (returns focus to editor)
 * - Ctrl/Cmd+Z / Ctrl+Shift+Z  Undo / Redo (native history)
 *
 * The default CodeMirror search UI is replaced with a React panel that matches
 * the app's design system (see FindReplacePanel).
 */
export const SourceEditor = forwardRef<SourceEditorRef, Props>(
  ({ value, onChange, className, readOnly = false, errors, onLogLineClick }, ref) => {
    const cmRef = useRef<ReactCodeMirrorRef | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [replaceMode, setReplaceMode] = useState(false);

    useImperativeHandle(ref, () => ({
      scrollToLine(lineNum) {
        const view = cmRef.current?.view;
        if (!view) return;
        try {
          const line = view.state.doc.line(lineNum);
          view.dispatch({
            effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
            selection: { anchor: line.from }
          });
          view.focus();
        } catch (e) {
          console.error("Failed to scroll to line:", e);
        }
      }
    }));

  // Ref-based bridge so the CM keymap (built once) can call the freshest React
  // setters without needing to rebuild extensions on every render.
  const openPanelRef = useRef<(replace: boolean) => void>(() => {});
  useEffect(() => {
    openPanelRef.current = (replace) => {
      setReplaceMode(replace);
      setPanelOpen(true);
    };
  });

  const lintExtension = useMemo(() => {
    return linter((view) => {
      if (!errors || errors.length === 0) return [];
      const diagnostics: Diagnostic[] = [];
      const doc = view.state.doc;
      
      for (const err of errors) {
        if (err.line > 0 && err.line <= doc.lines) {
          try {
            const line = doc.line(err.line);
            diagnostics.push({
              from: line.from,
              to: line.to,
              severity: 'error',
              message: err.message,
            });
          } catch (e) {
            console.error("Failed to add lint highlight:", e);
          }
        }
      }
      return diagnostics;
    });
  }, [errors]);

  const clickExtension = useMemo(() => {
    if (!onLogLineClick) return [];
    return EditorView.domEventHandlers({
      click(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;
        const line = view.state.doc.lineAt(pos);
        const lineText = line.text;
        const match = lineText.match(/:(\d+):/);
        if (match) {
          const targetLine = parseInt(match[1], 10);
          onLogLineClick(targetLine);
        }
      }
    });
  }, [onLogLineClick]);

  const extensions = useMemo(
    () => [
      xml(),
      search({ top: true }),
      xmlAutoClose,
      lintExtension,
      clickExtension,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-f',
            preventDefault: true,
            run: () => {
              openPanelRef.current(false);
              return true;
            },
          },
          {
            key: 'Mod-h',
            preventDefault: true,
            run: () => {
              openPanelRef.current(true);
              return true;
            },
          },
          { key: 'F3', preventDefault: true, run: findNext },
          { key: 'Shift-F3', preventDefault: true, run: findPrevious },
        ]),
      ),
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '12px',
        },
        '.cm-scroller': {
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          lineHeight: '1.5',
          overflow: 'auto',
        },
        '.cm-content': { padding: '4px 0' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: '1px solid hsl(var(--border) / 0.4)',
          color: 'hsl(var(--muted-foreground) / 0.5)',
        },
        '.cm-activeLineGutter': { backgroundColor: 'transparent' },
        '.cm-searchMatch': {
          backgroundColor: '#fef08a',
          outline: '1px solid #ca8a04',
          borderRadius: '2px',
        },
        '.cm-searchMatch span': {
          color: '#0f172a !important',
        },
        '.cm-searchMatch-selected': {
          backgroundColor: '#f97316 !important',
          outline: '2px solid #9a3412 !important',
          borderRadius: '2px',
          boxShadow: '0 0 0 1px #ffffff, 0 0 6px rgba(249, 115, 22, 0.6)',
        },
        '.cm-searchMatch-selected, .cm-searchMatch-selected span': {
          color: '#0f172a !important',
          fontWeight: '600',
        },
      }),
    ],
    [],
  );

  const view = cmRef.current?.view ?? null;

  return (
    <div className={cn('relative flex flex-col h-full min-h-0', className)}>
      {/* Editor Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1 bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 font-sans flex-shrink-0 select-none">
        <button
          type="button"
          onClick={() => {
            setReplaceMode(false);
            setPanelOpen(true);
          }}
          className="px-2 py-0.5 rounded hover:bg-gray-200 active:bg-gray-300 transition-colors font-medium flex items-center gap-1 border border-gray-300 shadow-sm bg-white"
          title="Search text (Ctrl+F)"
        >
          🔍 Find
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              setReplaceMode(true);
              setPanelOpen(true);
            }}
            className="px-2 py-0.5 rounded hover:bg-gray-200 active:bg-gray-300 transition-colors font-medium flex items-center gap-1 border border-gray-300 shadow-sm bg-white"
            title="Find and replace text (Ctrl+H)"
          >
            ✏️ Replace
          </button>
        )}
      </div>

      {panelOpen && view && (
        <FindReplacePanel
          view={view}
          showReplace={replaceMode}
          onToggleReplace={() => setReplaceMode((m) => !m)}
          onClose={() => setPanelOpen(false)}
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          ref={cmRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          readOnly={readOnly}
          height="100%"
          style={{ height: '100%' }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            highlightSelectionMatches: true,
            // Disable the default search panel + keymap — we render our own.
            searchKeymap: false,
            history: true,
          }}
        />
      </div>
    </div>
  );
});
