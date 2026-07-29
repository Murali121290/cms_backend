import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Replace,
  Repeat,
  TextSelect,
  X,
} from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from '@codemirror/search';
import { cn } from '@/utils/epubValidatorUtils';

interface Props {
  view: EditorView;
  showReplace: boolean;
  onToggleReplace: () => void;
  onClose: () => void;
}

interface ScopeRange {
  from: number;
  to: number;
}

interface MatchInfo {
  total: number;
  current: number;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';
const ALT_LABEL = IS_MAC ? '⌥' : 'Alt';

function buildQuery(
  search: string,
  replace: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  regex: boolean,
): SearchQuery | null {
  if (!search) return null;
  try {
    const q = new SearchQuery({
      search,
      replace,
      caseSensitive,
      wholeWord,
      regexp: regex,
    });
    return q.valid ? q : null;
  } catch {
    return null;
  }
}

function countMatches(view: EditorView, query: SearchQuery, scope?: ScopeRange): MatchInfo {
  const doc = view.state.doc;
  const from = scope?.from ?? 0;
  const to = scope?.to ?? doc.length;
  const cursor = query.getCursor(view.state, from, to);
  const selHead = view.state.selection.main.head;
  let total = 0;
  let current = 0;
  let m = cursor.next();
  while (!m.done) {
    total += 1;
    if (current === 0 && m.value.from >= selHead) {
      current = total;
    }
    m = cursor.next();
  }
  if (total > 0 && current === 0) current = total;
  return { total, current };
}

function replaceAllInRange(view: EditorView, query: SearchQuery, scope: ScopeRange): number {
  const cursor = query.getCursor(view.state, scope.from, scope.to);
  const changes: { from: number; to: number; insert: string }[] = [];
  let m = cursor.next();
  while (!m.done) {
    changes.push({ from: m.value.from, to: m.value.to, insert: query.replace });
    m = cursor.next();
  }
  if (changes.length) view.dispatch({ changes });
  return changes.length;
}

export function FindReplacePanel({ view, showReplace, onToggleReplace, onClose }: Props) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [inSelection, setInSelection] = useState(false);
  const [scope, setScope] = useState<ScopeRange | null>(null);
  const [matches, setMatches] = useState<MatchInfo>({ total: 0, current: 0 });
  const [error, setError] = useState<string | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const initial = view.state.doc.sliceString(sel.from, sel.to);
      if (!initial.includes('\n') && initial.length <= 200) {
        setFind(initial);
      } else if (initial.length > 0) {
        setScope({ from: sel.from, to: sel.to });
        setInSelection(true);
      }
    }
    findInputRef.current?.focus();
    findInputRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inSelection) setScope(null);
  }, [inSelection]);

  useEffect(() => {
    if (showReplace) replaceInputRef.current?.focus();
  }, [showReplace]);

  useEffect(() => {
    if (!find) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '', replace: '' })) });
      setMatches({ total: 0, current: 0 });
      setError(null);
      return;
    }
    const q = buildQuery(find, replace, caseSensitive, wholeWord, regex);
    if (!q) {
      setError(regex ? 'Invalid regular expression' : 'Invalid query');
      setMatches({ total: 0, current: 0 });
      return;
    }
    setError(null);
    view.dispatch({ effects: setSearchQuery.of(q) });
    setMatches(countMatches(view, q, inSelection && scope ? scope : undefined));
  }, [find, replace, caseSensitive, wholeWord, regex, inSelection, scope, view]);

  const runFindNext = useCallback(() => {
    findNext(view);
    const q = buildQuery(find, replace, caseSensitive, wholeWord, regex);
    if (q) setMatches(countMatches(view, q, inSelection && scope ? scope : undefined));
  }, [view, find, replace, caseSensitive, wholeWord, regex, inSelection, scope]);

  const runFindPrev = useCallback(() => {
    findPrevious(view);
    const q = buildQuery(find, replace, caseSensitive, wholeWord, regex);
    if (q) setMatches(countMatches(view, q, inSelection && scope ? scope : undefined));
  }, [view, find, replace, caseSensitive, wholeWord, regex, inSelection, scope]);

  const runReplaceOne = useCallback(() => {
    replaceNext(view);
  }, [view]);

  const runReplaceAll = useCallback(() => {
    const q = buildQuery(find, replace, caseSensitive, wholeWord, regex);
    if (!q) return;
    if (inSelection && scope) {
      replaceAllInRange(view, q, scope);
    } else {
      replaceAll(view);
    }
  }, [view, find, replace, caseSensitive, wholeWord, regex, inSelection, scope]);

  const handleFindKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) runFindPrev();
        else runFindNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        view.focus();
      }
    },
    [runFindNext, runFindPrev, onClose, view],
  );

  const handleReplaceKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.altKey || e.ctrlKey || e.metaKey) runReplaceAll();
        else runReplaceOne();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        view.focus();
      }
    },
    [runReplaceAll, runReplaceOne, onClose, view],
  );

  const countLabel = useMemo(() => {
    if (!find) return '';
    if (error) return error;
    if (matches.total === 0) return 'No results';
    return `${matches.current} of ${matches.total}`;
  }, [find, error, matches]);

  const noMatches = matches.total === 0;

  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={150}>
      <div
        role="toolbar"
        aria-label="Find and Replace"
        className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm shadow-sm"
      >
        <div className="flex items-start gap-1 px-2 py-1.5">
          <ActionTip
            label={showReplace ? 'Hide Replace' : 'Show Replace'}
            shortcut={`${MOD_LABEL}+H`}
          >
            <button
              type="button"
              onClick={onToggleReplace}
              aria-label={showReplace ? 'Hide Replace field' : 'Show Replace field'}
              aria-expanded={showReplace}
              className="shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {showReplace ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          </ActionTip>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {/* Find row */}
            <div className="flex items-center gap-1">
              <div className="relative flex-1 min-w-0 max-w-md">
                <input
                  ref={findInputRef}
                  type="text"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  onKeyDown={handleFindKeyDown}
                  placeholder="Find"
                  aria-label="Find"
                  className={cn(
                    'w-full h-8 pl-2.5 pr-24 text-xs bg-muted/40 rounded border font-mono',
                    'focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary',
                    error ? 'border-red-400' : 'border-border',
                  )}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                  <InputToggle
                    active={caseSensitive}
                    onClick={() => setCaseSensitive((v) => !v)}
                    ariaLabel="Match Case"
                    tooltipLabel="Match Case"
                    shortcut={`${ALT_LABEL}+C`}
                  >
                    <span className="font-semibold">Aa</span>
                  </InputToggle>
                  <InputToggle
                    active={wholeWord}
                    onClick={() => setWholeWord((v) => !v)}
                    ariaLabel="Match Whole Word"
                    tooltipLabel="Match Whole Word"
                    shortcut={`${ALT_LABEL}+W`}
                  >
                    <span className="font-mono underline decoration-1 underline-offset-2">ab</span>
                  </InputToggle>
                  <InputToggle
                    active={regex}
                    onClick={() => setRegex((v) => !v)}
                    ariaLabel="Use Regular Expression"
                    tooltipLabel="Use Regular Expression"
                    shortcut={`${ALT_LABEL}+R`}
                  >
                    <span className="font-mono">.*</span>
                  </InputToggle>
                </div>
              </div>

              <div
                aria-live="polite"
                aria-atomic="true"
                className={cn(
                  'shrink-0 text-[11px] tabular-nums min-w-[6.5rem] text-center px-1',
                  error ? 'text-red-500' : 'text-muted-foreground',
                )}
              >
                {countLabel}
              </div>

              <IconAction
                onClick={runFindPrev}
                disabled={noMatches}
                ariaLabel="Find Previous"
                tooltipLabel="Previous Match"
                shortcut="Shift+F3"
              >
                <ChevronUp className="w-4 h-4" />
              </IconAction>
              <IconAction
                onClick={runFindNext}
                disabled={noMatches}
                ariaLabel="Find Next"
                tooltipLabel="Next Match"
                shortcut="F3"
              >
                <ChevronDown className="w-4 h-4" />
              </IconAction>
              <IconAction
                onClick={() => setInSelection((v) => !v)}
                active={inSelection}
                ariaLabel="Find in Selection"
                tooltipLabel="Find in Selection"
                shortcut={`${ALT_LABEL}+L`}
              >
                <TextSelect className="w-4 h-4" />
              </IconAction>

              <div className="w-px h-5 bg-border mx-0.5" aria-hidden />

              <IconAction
                onClick={() => {
                  onClose();
                  view.focus();
                }}
                ariaLabel="Close Search"
                tooltipLabel="Close Search"
                shortcut="Esc"
              >
                <X className="w-4 h-4" />
              </IconAction>
            </div>

            {/* Replace row */}
            {showReplace && (
              <div className="flex items-center gap-1">
                <div className="relative flex-1 min-w-0 max-w-md">
                  <input
                    ref={replaceInputRef}
                    type="text"
                    value={replace}
                    onChange={(e) => setReplace(e.target.value)}
                    onKeyDown={handleReplaceKeyDown}
                    placeholder="Replace"
                    aria-label="Replace"
                    className="w-full h-8 pl-2.5 pr-2 text-xs bg-muted/40 rounded border border-border font-mono focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div className="shrink-0 min-w-[6.5rem]" />

                <IconAction
                  onClick={runReplaceOne}
                  disabled={noMatches}
                  ariaLabel="Replace"
                  tooltipLabel="Replace"
                  shortcut="Enter"
                >
                  <Replace className="w-4 h-4" />
                </IconAction>
                <IconAction
                  onClick={runReplaceAll}
                  disabled={noMatches}
                  ariaLabel="Replace All"
                  tooltipLabel={inSelection ? 'Replace All in Selection' : 'Replace All'}
                  shortcut={`${MOD_LABEL}+${ALT_LABEL}+Enter`}
                >
                  <Repeat className="w-4 h-4" />
                </IconAction>

                <div className="w-px h-5 bg-border mx-0.5" aria-hidden />
                <div className="w-8" aria-hidden />
              </div>
            )}
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

/**
 * Radix tooltip wrapper. Shows a small floating panel on hover *and* keyboard
 * focus (Radix handles this automatically), with a kbd chip for the shortcut.
 */
function ActionTip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          avoidCollisions
          className="z-50 rounded-md bg-popover text-popover-foreground border border-border shadow-md px-2 py-1 text-[11px] flex items-center gap-1.5 select-none pointer-events-none data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0"
        >
          <span>{label}</span>
          {shortcut && (
            <kbd className="ml-1 px-1 py-px rounded bg-muted text-muted-foreground border border-border text-[10px] font-mono">
              {shortcut}
            </kbd>
          )}
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function IconAction({
  onClick,
  ariaLabel,
  tooltipLabel,
  shortcut,
  children,
  active = false,
  disabled = false,
}: {
  onClick: () => void;
  ariaLabel: string;
  tooltipLabel: string;
  shortcut?: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <ActionTip label={tooltipLabel} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={active || undefined}
        disabled={disabled}
        className={cn(
          'shrink-0 w-8 h-8 flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          disabled
            ? 'text-muted-foreground/30 cursor-not-allowed'
            : active
              ? 'bg-primary/15 text-primary ring-1 ring-primary/40 cursor-pointer hover:bg-primary/20'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer',
        )}
      >
        {children}
      </button>
    </ActionTip>
  );
}

/**
 * Compact toggle that lives inside the search input's right edge. Smaller than
 * IconAction to fit inline, but still has a large enough touch target and a
 * proper tooltip so users don't have to guess what Aa / ab / .* mean.
 */
function InputToggle({
  active,
  onClick,
  ariaLabel,
  tooltipLabel,
  shortcut,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  tooltipLabel: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <ActionTip label={tooltipLabel} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={active}
        className={cn(
          'w-6 h-6 flex items-center justify-center rounded text-[11px] leading-none transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          active
            ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {children}
      </button>
    </ActionTip>
  );
}
