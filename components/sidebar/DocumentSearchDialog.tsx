"use client";

import { FileIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { documentTitle } from "../documentPaths";

function parseSnippet(snippet: string) {
  const tokens = snippet.split(/(<mark>|<\/mark>)/g);
  const parts: Array<{ highlighted: boolean; text: string }> = [];
  let highlighted = false;

  for (const token of tokens) {
    if (token === "<mark>") {
      highlighted = true;
      continue;
    }

    if (token === "</mark>") {
      highlighted = false;
      continue;
    }

    if (token) {
      parts.push({ highlighted, text: token });
    }
  }

  return parts;
}

function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts = parseSnippet(snippet);

  return (
    <>
      {parts.map((part, index) => {
        return part.highlighted ? (
          <mark key={`${part.text}-${index}`} className="rounded bg-amber-300/25 px-0.5 text-amber-100">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        );
      })}
    </>
  );
}

export default function DocumentSearchDialog({
  onClose,
  onOpenDocument,
  open,
}: {
  onClose: () => void;
  onOpenDocument: (documentPath: string) => void;
  open: boolean;
}) {
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    let ignore = false;
    const timer = window.setTimeout(async () => {
      try {
        setIsSearching(true);

        if (!window.learner) {
          throw new Error("Search is available in Electron.");
        }

        const searchResults = await window.learner.searchDocuments(trimmedQuery, 20);

        if (!ignore) {
          setResults(searchResults);
          setError("");
        }
      } catch (searchError) {
        if (!ignore) {
          setResults([]);
          setError(searchError instanceof Error ? searchError.message : "Search failed.");
        }
      } finally {
        if (!ignore) {
          setIsSearching(false);
        }
      }
    }, 120);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  function openDocument(documentPath: string) {
    onOpenDocument(documentPath);
    onClose();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      openDocument(results[0].path);
    }
  }

  function updateQuery(value: string) {
    setQuery(value);

    if (!value.trim()) {
      setError("");
      setIsSearching(false);
      setResults([]);
    }
  }

  return (
    <div className="app-no-drag fixed inset-0 z-50 bg-black/35 px-4 pt-[12vh] backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section className="relative mx-auto flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[#191919]/95 text-white shadow-[0_32px_90px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
        <div className="flex h-14 shrink-0 items-center gap-3 px-4">
          <MagnifyingGlassIcon size={20} className="shrink-0 text-white/45" />
          <input
            ref={inputRef}
            aria-label="Search notes"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-white/35"
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search notes..."
            value={query}
          />
          <button
            type="button"
            aria-label="Close search"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {!query.trim() ? (
            <div className="px-3 py-10 text-center text-sm text-white/45">
              Search titles and note contents.
            </div>
          ) : error ? (
            <div className="px-3 py-10 text-center text-sm text-red-200">{error}</div>
          ) : isSearching ? (
            <div className="px-3 py-10 text-center text-sm text-white/45">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-white/45">No matching notes.</div>
          ) : (
            <div className="space-y-1">
              {results.map((result) => (
                <button
                  type="button"
                  className="group flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                  key={result.path}
                  onClick={() => openDocument(result.path)}
                >
                  <FileIcon size={18} className="mt-0.5 shrink-0 text-white/50 group-hover:text-white/75" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white/90">
                      {result.title || documentTitle(result.path)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-white/38">{result.path}</span>
                    <span className="mt-1.5 line-clamp-2 block text-sm leading-5 text-white/62">
                      <HighlightedSnippet snippet={result.snippet || result.title || result.path} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
