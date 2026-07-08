"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { GraphFieldShell, graphInputClassName } from "./GraphField";

export default function ConceptCombobox({
  label,
  onSelectConcept,
  onValueChange,
  placeholder,
  selectedConcept,
  value,
}: {
  label: string;
  onSelectConcept: (concept: KnowledgeConceptSearchResult | null) => void;
  onValueChange: (value: string) => void;
  placeholder?: string;
  selectedConcept: KnowledgeConceptSearchResult | null;
  value: string;
}) {
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<KnowledgeConceptSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!focused || !value.trim()) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      window.learner
        ?.searchGraphConcepts(value, 8)
        .then((nextResults) => {
          if (active) setResults(nextResults ?? []);
        })
        .catch(() => {
          if (active) setResults([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [focused, value]);

  const visibleResults = focused && value.trim() ? results : [];

  function closeSoon() {
    blurTimerRef.current = window.setTimeout(() => setFocused(false), 120);
  }

  function cancelClose() {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }

  return (
    <GraphFieldShell
      help={
        selectedConcept
          ? `Using existing concept: ${selectedConcept.name}`
          : value.trim()
            ? "No selection means this will create a new concept with this name."
            : undefined
      }
      label={label}
    >
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/34" size={16} />
        <input
          className={`${graphInputClassName} pl-9`}
          onBlur={closeSoon}
          onChange={(event) => {
            const nextValue = event.target.value;
            onValueChange(nextValue);
            if (selectedConcept?.name !== nextValue) onSelectConcept(null);
          }}
          onFocus={() => {
            cancelClose();
            setFocused(true);
          }}
          placeholder={placeholder}
          value={value}
        />

        {focused && value.trim() && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-50 max-h-64 overflow-y-auto rounded-xl bg-[#202020]/98 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.1] backdrop-blur-xl"
            onMouseDown={cancelClose}
          >
            {loading ? (
              <p className="px-3 py-2 text-sm text-white/42">Searching...</p>
            ) : visibleResults.length > 0 ? (
              visibleResults.map((concept) => (
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.07]"
                  key={concept.id}
                  onClick={() => {
                    onSelectConcept(concept);
                    onValueChange(concept.name);
                    setFocused(false);
                  }}
                  type="button"
                >
                  <span className="block break-words text-sm font-medium text-white/86">{concept.name}</span>
                  {concept.type && (
                    <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-white/38">{concept.type}</span>
                  )}
                  {concept.summary && <span className="mt-1 block text-xs leading-5 text-white/45">{concept.summary}</span>}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-white/42">No existing concept found. Submit to create one.</p>
            )}
          </div>
        )}
      </div>
    </GraphFieldShell>
  );
}
