/**
 * HelpSearch — Debounced search input with dropdown results.
 *
 * Features:
 * - 300ms debounce on input
 * - Results dropdown with matching articles
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 *
 * COMPLIANCE: No PHI in search queries or results (Rule 6).
 */

import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from '../icons';
import { cn } from '../../lib/cn';
import { searchHelp, type HelpArticle } from '../../lib/help-api';

interface HelpSearchProps {
  onSelect: (article: HelpArticle) => void;
  placeholder?: string;
  className?: string;
}

export function HelpSearch({
  onSelect,
  placeholder = 'Search help articles...',
  className,
}: HelpSearchProps): ReactNode {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HelpArticle[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      void searchHelp(query.trim()).then((res) => {
        setResults(res.articles.slice(0, 8));
        setOpen(res.articles.length > 0);
        setActiveIndex(-1);
        setSearching(false);
      });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleSelect = useCallback(
    (article: HelpArticle) => {
      onSelect(article);
      setQuery('');
      setOpen(false);
      setActiveIndex(-1);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < results.length) {
            handleSelect(results[activeIndex] as HelpArticle);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
          break;
      }
    },
    [open, results, activeIndex, handleSelect],
  );

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      const activeItem = items[activeIndex];
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        inputRef.current &&
        !inputRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'block w-full rounded-lg border border-border bg-surface pl-10 pr-10 py-2.5 text-sm text-content',
            'placeholder:text-content-tertiary',
            'transition-colors duration-150',
            'focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus',
          )}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-label="Search help articles"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-content-tertiary hover:text-content"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-surface-secondary shadow-lg"
        >
          {searching ? (
            <li className="px-4 py-3 text-sm text-content-tertiary">Searching...</li>
          ) : results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-content-tertiary">No results found</li>
          ) : (
            results.map((article, idx) => (
              <li
                key={article.id}
                role="option"
                aria-selected={idx === activeIndex}
                className={cn(
                  'cursor-pointer px-4 py-3 transition-colors duration-100',
                  idx === activeIndex
                    ? 'bg-surface-tertiary text-content'
                    : 'text-content-secondary hover:bg-surface-tertiary hover:text-content',
                )}
                onClick={() => {
                  handleSelect(article);
                }}
                onMouseEnter={() => {
                  setActiveIndex(idx);
                }}
              >
                <p className="text-sm font-medium">{article.title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-content-tertiary">
                  {article.content.slice(0, 120)}...
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
