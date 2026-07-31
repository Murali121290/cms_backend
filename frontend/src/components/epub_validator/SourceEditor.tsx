import { useMemo, useRef, useState, useEffect } from 'react';
import CodeMirror, { EditorView, keymap, Prec } from '@uiw/react-codemirror';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { xml } from '@codemirror/lang-xml';
import { search, findNext, findPrevious } from '@codemirror/search';
import { cn } from '@/utils/epubValidatorUtils';
import { FindReplacePanel } from './FindReplacePanel';

interface Props {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  readOnly?: boolean;
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
export function SourceEditor({ value, onChange, className, readOnly = false }: Props) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);

  // Ref-based bridge so the CM keymap (built once) can call the freshest React
  // setters without needing to rebuild extensions on every render.
  const openPanelRef = useRef<(replace: boolean) => void>(() => {});
  useEffect(() => {
    openPanelRef.current = (replace) => {
      setReplaceMode(replace);
      setPanelOpen(true);
    };
  });

  const extensions = useMemo(
    () => [
      xml(),
      // Provides the search state field + highlight-all styling. We keep the
      // extension but suppress its default panel via basicSetup below.
      search({ top: true }),
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
}
