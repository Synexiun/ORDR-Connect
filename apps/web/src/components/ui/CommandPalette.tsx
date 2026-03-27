import { type ReactNode, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '../../lib/cn';
import { Search } from '../icons';

interface Command {
  id: string;
  label: string;
  icon?: ReactNode;
  action: () => void;
  group?: string;
}

interface CommandPaletteProps {
  commands: Command[];
}

export function CommandPalette({ commands }: CommandPaletteProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open/close on Ctrl+K / Meta+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusIndex(0);
      // Delay to allow dialog to render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (query.trim() === '') return commands;
    const lower = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lower) ||
        (cmd.group !== undefined && cmd.group.toLowerCase().includes(lower)),
    );
  }, [commands, query]);

  // Group filtered results
  const grouped = useMemo(() => {
    const groups: Map<string, Command[]> = new Map();
    for (const cmd of filtered) {
      const g = cmd.group ?? '';
      const arr = groups.get(g);
      if (arr) {
        arr.push(cmd);
      } else {
        groups.set(g, [cmd]);
      }
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    const result: Command[] = [];
    for (const cmds of grouped.values()) {
      result.push(...cmds);
    }
    return result;
  }, [grouped]);

  // Scroll focused item into view
  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll('[data-command-item]');
    items?.[focusIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, focusIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setFocusIndex(0);
  }, []);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusIndex((prev) => Math.min(prev + 1, flatList.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[focusIndex]) {
            flatList[focusIndex].action();
            close();
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    },
    [flatList, focusIndex, close],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        close();
      }
    },
    [close],
  );

  if (!open) return null;

  let itemIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/60 pt-[20vh]"
      onClick={handleBackdropClick}
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
    >
      <div
        className={cn(
          'w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface-secondary shadow-2xl',
          'animate-fade-in',
        )}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-content-secondary" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocusIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-content placeholder:text-content-tertiary focus:outline-none"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-activedescendant={
              flatList[focusIndex] ? `cmd-${flatList[focusIndex].id}` : undefined
            }
          />
          <kbd className="hidden rounded border border-border bg-surface-tertiary px-1.5 py-0.5 text-2xs text-content-tertiary sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-72 overflow-y-auto px-2 py-2"
          role="listbox"
          aria-label="Commands"
        >
          {flatList.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-content-secondary">
              No results found
            </div>
          ) : (
            Array.from(grouped.entries()).map(([group, cmds]) => (
              <div key={group || '__ungrouped'}>
                {group !== '' && (
                  <div className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                    {group}
                  </div>
                )}
                {cmds.map((cmd) => {
                  const currentIdx = itemIndex;
                  itemIndex += 1;
                  const isFocused = currentIdx === focusIndex;

                  return (
                    <div
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      role="option"
                      data-command-item
                      aria-selected={isFocused}
                      onClick={() => {
                        cmd.action();
                        close();
                      }}
                      onMouseEnter={() => {
                        setFocusIndex(currentIdx);
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-100',
                        isFocused
                          ? 'bg-surface-tertiary text-content'
                          : 'text-content-secondary hover:bg-surface-tertiary hover:text-content',
                      )}
                    >
                      {cmd.icon !== undefined && (
                        <span className="shrink-0" aria-hidden="true">
                          {cmd.icon}
                        </span>
                      )}
                      <span className="flex-1">{cmd.label}</span>
                      {isFocused && (
                        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-2xs text-content-tertiary">
                          Enter
                        </kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-2xs text-content-tertiary">
            <kbd className="rounded border border-border bg-surface-tertiary px-1 py-0.5">
              {'\u2191'}
            </kbd>
            <kbd className="rounded border border-border bg-surface-tertiary px-1 py-0.5">
              {'\u2193'}
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5 text-2xs text-content-tertiary">
            <kbd className="rounded border border-border bg-surface-tertiary px-1 py-0.5">
              {'\u21B5'}
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1.5 text-2xs text-content-tertiary">
            <kbd className="rounded border border-border bg-surface-tertiary px-1 py-0.5">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
