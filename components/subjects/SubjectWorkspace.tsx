"use client";

import {
  ArrowSquareOutIcon,
  CheckSquareIcon,
  FileArrowUpIcon,
  FileTextIcon,
  LinkIcon,
  NotePencilIcon,
  PlusIcon,
  PrinterIcon,
  SpinnerGapIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import { readAiSettings } from "../ai/aiSettings";
import type { CurrentDocumentAgentTools } from "../editor/TiptapEditor";
import RichMarkdown from "../markdown/RichMarkdown";
import {
  readCheatSheetRestrictions,
  writeCheatSheetRestrictions,
  type CheatSheetRestrictions,
} from "./cheatSheetSettings";

type GeneratedCheatSheet = {
  title: string;
  sides: Array<{ number: number; markdown: string }>;
  citations: SubjectSourceCitation[];
  restrictions: CheatSheetRestrictions;
};

type AddMode = "text" | "url" | "note" | null;

function bridge() {
  if (!window.learner) throw new Error("Subject materials are available in the Learner desktop app.");
  return window.learner;
}

function cleanDocumentTitle(title: string, fallback: string) {
  return (title.trim() || fallback).replace(/[\\/]/g, "-").replace(/\.json$/i, "").trim();
}

function documentPath(subjectPath: string, title: string) {
  return `${subjectPath.replace(/\/+$/g, "")}/${title}.json`;
}

function collectDocumentPaths(nodes: DocumentNode[], paths = new Set<string>()) {
  for (const node of nodes) {
    if (node.type === "file") paths.add(node.path);
    if (node.children) collectDocumentPaths(node.children, paths);
  }
  return paths;
}

function collectDocumentOptions(nodes: DocumentNode[], options: Array<{ path: string; title: string }> = []) {
  for (const node of nodes) {
    if (node.type === "file") options.push({ path: node.path, title: node.path.replace(/\.json$/i, "") });
    if (node.children) collectDocumentOptions(node.children, options);
  }
  return options;
}

function withCitationSection(markdown: string, citations: SubjectSourceCitation[]) {
  const unique = new Map<string, SubjectSourceCitation>();
  citations.forEach((citation) => unique.set(citation.url || citation.sourceId || citation.title, citation));
  if (!unique.size) return markdown;
  const sourceLines = [...unique.values()].map((citation) => citation.url
    ? `- [${citation.title}](${citation.url})`
    : `- ${citation.title}`);
  return `${markdown.trim()}\n\n## Sources\n\n${sourceLines.join("\n")}`;
}

function cheatSheetMarkdown(result: GeneratedCheatSheet) {
  return result.sides
    .sort((left, right) => left.number - right.number)
    .map((side) => `## Side ${side.number}\n\n${side.markdown.trim()}`)
    .join("\n\n---\n\n");
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/40" htmlFor={htmlFor}>{children}</label>;
}

const inputClass = "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-200/35 focus:bg-black/30";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const primaryButtonClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-100 px-4 py-2 text-sm font-medium text-[#142017] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40";

export default function SubjectWorkspace({
  ensureDocumentTools,
  onClose,
  onDocumentsChanged,
  onOpenDocument,
  subjectPath,
}: {
  ensureDocumentTools: (documentPath: string) => Promise<CurrentDocumentAgentTools | null>;
  onClose: () => void;
  onDocumentsChanged: () => void;
  onOpenDocument: (documentPath: string) => void;
  subjectPath: string;
}) {
  const [sources, setSources] = useState<SubjectSource[]>([]);
  const [availableNotes, setAvailableNotes] = useState<Array<{ path: string; title: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [textTitle, setTextTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [notePath, setNotePath] = useState("");
  const [outsideSources, setOutsideSources] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [cheatTitle, setCheatTitle] = useState("");
  const [professorInstructions, setProfessorInstructions] = useState("");
  const [restrictions, setRestrictions] = useState(() => readCheatSheetRestrictions(subjectPath));
  const [generatedNote, setGeneratedNote] = useState<(SubjectNoteGenerationResult & { documentPath: string }) | null>(null);
  const [generatedCheat, setGeneratedCheat] = useState<(GeneratedCheatSheet & { documentPath: string }) | null>(null);
  const [loading, setLoading] = useState<"sources" | "import" | "add" | "note" | "cheat" | null>("sources");
  const [error, setError] = useState("");

  const subjectName = subjectPath.split("/").at(-1) || subjectPath;

  async function loadSources() {
    try {
      const next = await bridge().listSubjectSources(subjectPath);
      setSources(next ?? []);
      setSelectedIds((current) => new Set([...current].filter((id) => next.some((source) => source.id === id))));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load subject materials.");
    } finally {
      setLoading((current) => current === "sources" ? null : current);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([bridge().listSubjectSources(subjectPath), bridge().listDocuments()])
      .then(([next, documents]) => {
        if (cancelled) return;
        setSources(next ?? []);
        setAvailableNotes(collectDocumentOptions(documents.tree));
        setSelectedIds(new Set());
        setRestrictions(readCheatSheetRestrictions(subjectPath));
        setError("");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load subject materials.");
      })
      .finally(() => {
        if (!cancelled) setLoading(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectPath]);

  useEffect(() => {
    if (error) toast.error(error, { id: "subject-workspace-error" });
  }, [error]);

  function updateRestrictions(update: Partial<CheatSheetRestrictions>) {
    setRestrictions((current) => writeCheatSheetRestrictions({ ...current, ...update }, subjectPath));
  }

  async function importFiles() {
    setLoading("import");
    setError("");
    try {
      await bridge().importSubjectFiles(subjectPath);
      await loadSources();
    } catch (importError) {
      try {
        const importedBeforeFailure = await bridge().listSubjectSources(subjectPath);
        setSources(importedBeforeFailure);
      } catch {
        // Keep the original import error when refreshing partially imported sources also fails.
      }
      setError(importError instanceof Error ? importError.message : "Could not import files.");
    } finally {
      setLoading(null);
    }
  }

  async function addSource(event: FormEvent) {
    event.preventDefault();
    if (!addMode) return;
    setLoading("add");
    setError("");
    try {
      if (addMode === "text") await bridge().addSubjectTextSource({ subjectPath, title: textTitle.trim(), text: text.trim() });
      if (addMode === "url") await bridge().addSubjectUrlSource({ subjectPath, url: url.trim() });
      if (addMode === "note") await bridge().addSubjectNoteSource({ subjectPath, notePath: notePath.trim() });
      setAddMode(null);
      setTextTitle("");
      setText("");
      setUrl("");
      setNotePath("");
      await loadSources();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add the source.");
    } finally {
      setLoading(null);
    }
  }

  async function removeSource(sourceId: string) {
    setError("");
    try {
      await bridge().removeSubjectSource(subjectPath, sourceId);
      setSources((current) => current.filter((source) => source.id !== sourceId));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(sourceId);
        return next;
      });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the source.");
    }
  }

  async function saveGeneratedDocument(title: string, markdown: string, fallbackTitle: string) {
    const cleanTitle = cleanDocumentTitle(title, fallbackTitle);
    const tree = await window.learner!.listDocuments();
    const existingPaths = collectDocumentPaths(tree.tree);
    let path = documentPath(subjectPath, cleanTitle);
    let suffix = 2;
    while (existingPaths.has(path)) {
      path = documentPath(subjectPath, `${cleanTitle} (${suffix})`);
      suffix += 1;
    }
    await window.learner!.createDocumentFile(path.replace(/\.json$/i, ""));
    onDocumentsChanged();
    const tools = await ensureDocumentTools(path);
    if (!tools) throw new Error("The note editor did not become ready.");
    const document = tools.markdownToDocument(markdown);
    await window.learner!.saveDocument(path, document);
    tools.applyPatch({
      id: `subject_${Date.now()}_${crypto.randomUUID()}`,
      documentPath: path,
      baseHash: tools.read().patchBaseHash,
      summary: `Write ${cleanTitle}`,
      changeType: "replace",
      replacementMarkdown: markdown,
      status: "pending",
      createdAt: Date.now(),
    });
    onDocumentsChanged();
    return path;
  }

  async function generateNote() {
    setLoading("note");
    setError("");
    try {
      const result = await bridge().generateSubjectNote({
        subjectPath,
        selectedSourceIds: [...selectedIds],
        includeOutsideSources: outsideSources,
        title: noteTitle.trim(),
        settings: readAiSettings(),
      });
      const savedMarkdown = withCitationSection(result.markdown, result.citations);
      const savedTitle = noteTitle.trim() || result.title;
      const path = await saveGeneratedDocument(savedTitle, savedMarkdown, `${subjectName} notes`);
      setGeneratedNote({ ...result, title: savedTitle, documentPath: path });
      toast.success("Generated note saved in the subject folder.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Could not generate the note.");
    } finally {
      setLoading(null);
    }
  }

  async function generateCheatSheet() {
    setLoading("cheat");
    setError("");
    const normalized = writeCheatSheetRestrictions(restrictions, subjectPath);
    try {
      const result = await bridge().generateSubjectCheatSheet({
        subjectPath,
        selectedSourceIds: [...selectedIds],
        includeOutsideSources: outsideSources,
        title: cheatTitle.trim(),
        restrictions: normalized,
        professorInstructions: professorInstructions.trim(),
        settings: readAiSettings(),
      });
      const normalizedResult: GeneratedCheatSheet = {
        citations: result.citations,
        restrictions: normalized,
        sides: result.sides.map((side) => ({ markdown: side.markdown, number: side.side })),
        title: result.title,
      };
      const markdown = withCitationSection(cheatSheetMarkdown(normalizedResult), result.citations);
      const savedTitle = cheatTitle.trim() || result.title;
      const path = await saveGeneratedDocument(savedTitle, markdown, `${subjectName} cheat sheet`);
      setGeneratedCheat({ ...normalizedResult, title: savedTitle, documentPath: path });
      toast.success("Cheat sheet saved in the subject folder.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Could not generate the cheat sheet.");
    } finally {
      setLoading(null);
    }
  }

  function openSavedDocument(path: string) {
    onClose();
    onOpenDocument(path);
  }

  const allSelected = sources.length > 0 && selectedIds.size === sources.length;
  const canGenerate = selectedIds.size > 0;

  return (
    <section className="subject-workspace-screen fixed inset-0 z-[60] flex min-h-0 flex-col bg-[#191b1a] text-white">
      <header className="app-drag flex h-12 shrink-0 items-center gap-4 border-b border-white/10 bg-[#202321]/95 px-4">
        <div className="app-no-drag min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{subjectName}</p>
          <p className="truncate text-[11px] text-white/38">Subject workspace · {subjectPath}</p>
        </div>
        <button className="app-no-drag rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-white" onClick={onClose} type="button" aria-label="Close subject workspace">
          <XIcon size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1500px] gap-5 p-4 lg:grid-cols-[minmax(280px,0.75fr)_minmax(520px,1.45fr)] lg:p-6">
          <aside className="space-y-5">
            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-black/10">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Materials</h2>
                  <p className="mt-0.5 text-xs text-white/42">{sources.length} source{sources.length === 1 ? "" : "s"}</p>
                </div>
                <button className={buttonClass} disabled={loading !== null} onClick={importFiles} type="button">
                  {loading === "import" ? <SpinnerGapIcon className="animate-spin" size={15} /> : <FileArrowUpIcon size={15} />}
                  Import
                </button>
              </div>

              <div className="mb-2 flex items-center justify-between border-b border-white/8 pb-2">
                <button
                  className="flex items-center gap-2 text-xs text-white/55 transition hover:text-white"
                  onClick={() => setSelectedIds(allSelected ? new Set() : new Set(sources.map((source) => source.id)))}
                  type="button"
                >
                  <CheckSquareIcon size={15} weight={allSelected ? "fill" : "regular"} />
                  {allSelected ? "Clear selection" : "Select all"}
                </button>
                <span className="text-[11px] tabular-nums text-emerald-100/55">{selectedIds.size} selected</span>
              </div>

              <div className="max-h-[42vh] space-y-1.5 overflow-y-auto pr-1">
                {loading === "sources" && <p className="py-8 text-center text-xs text-white/40">Loading materials...</p>}
                {loading !== "sources" && sources.length === 0 && <p className="py-8 text-center text-xs text-white/40">Add files, text, a URL, or an existing note.</p>}
                {sources.map((source) => (
                  <div className={`group flex items-center gap-2 rounded-lg border px-2 py-2 transition ${selectedIds.has(source.id) ? "border-emerald-200/20 bg-emerald-200/[0.07]" : "border-transparent bg-white/[0.025] hover:bg-white/[0.05]"}`} key={source.id}>
                    <input
                      aria-label={`Select ${source.title}`}
                      checked={selectedIds.has(source.id)}
                      className="accent-emerald-200"
                      onChange={() => setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(source.id)) next.delete(source.id); else next.add(source.id);
                        return next;
                      })}
                      type="checkbox"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-white/80">{source.title}</p>
                      <p className="truncate text-[10px] uppercase tracking-wide text-white/32">{source.kind}{source.url || source.notePath || source.fileName ? ` · ${source.url || source.notePath || source.fileName}` : ""}</p>
                    </div>
                    <button className="rounded p-1 text-white/25 opacity-0 transition hover:bg-red-300/10 hover:text-red-200 group-hover:opacity-100" onClick={() => void removeSource(source.id)} type="button" aria-label={`Remove ${source.title}`}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <button className={buttonClass} onClick={() => setAddMode("text")} type="button"><NotePencilIcon size={14} /> Text</button>
                <button className={buttonClass} onClick={() => setAddMode("url")} type="button"><LinkIcon size={14} /> URL</button>
                <button className={buttonClass} onClick={() => setAddMode("note")} type="button"><FileTextIcon size={14} /> Note</button>
              </div>

              {addMode && (
                <form className="mt-3 space-y-2 rounded-lg border border-white/10 bg-black/15 p-3" onSubmit={addSource}>
                  {addMode === "text" && <>
                    <input aria-label="Text source title" className={inputClass} onChange={(event) => setTextTitle(event.target.value)} placeholder="Source title" required value={textTitle} />
                    <textarea aria-label="Pasted source text" className={`${inputClass} min-h-28 resize-y`} onChange={(event) => setText(event.target.value)} placeholder="Paste source text..." required value={text} />
                  </>}
                  {addMode === "url" && <input aria-label="Article URL" className={inputClass} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" required type="url" value={url} />}
                  {addMode === "note" && <select aria-label="Existing note" className={inputClass} onChange={(event) => setNotePath(event.target.value)} required value={notePath}><option value="">Select a Learner note</option>{availableNotes.map((note) => <option key={note.path} value={note.path}>{note.title}</option>)}</select>}
                  <div className="flex justify-end gap-2">
                    <button className={buttonClass} onClick={() => setAddMode(null)} type="button">Cancel</button>
                    <button className={primaryButtonClass} disabled={loading === "add"} type="submit"><PlusIcon size={14} /> Add</button>
                  </div>
                </form>
              )}
            </section>

            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <span>
                <span className="block text-sm font-medium">Outside sources</span>
                <span className="mt-1 block text-xs leading-relaxed text-white/42">Allow generation to supplement selected materials.</span>
              </span>
              <input checked={outsideSources} className="h-4 w-4 accent-emerald-200" onChange={(event) => setOutsideSources(event.target.checked)} type="checkbox" />
            </label>
          </aside>

          <main className="min-w-0 space-y-5">
            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4 lg:p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="rounded-lg bg-sky-200/10 p-2 text-sky-100"><NotePencilIcon size={18} /></div>
                <div><h2 className="text-sm font-semibold">Generated notes</h2><p className="mt-1 text-xs text-white/42">Build an editable study note from the selected materials.</p></div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className={inputClass} onChange={(event) => setNoteTitle(event.target.value)} placeholder={`${subjectName} study notes`} value={noteTitle} />
                <button className={`${primaryButtonClass} shrink-0`} disabled={!canGenerate || loading !== null} onClick={() => void generateNote()} type="button">
                  {loading === "note" && <SpinnerGapIcon className="animate-spin" size={15} />}
                  Generate note
                </button>
              </div>
              {generatedNote && (
                <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/15">
                  <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{generatedNote.title}</p><p className="text-[11px] text-emerald-100/50">Saved as an editable note</p></div>
                    <button className={buttonClass} onClick={() => openSavedDocument(generatedNote.documentPath)} type="button"><ArrowSquareOutIcon size={14} /> Open</button>
                  </div>
                  <RichMarkdown className="max-h-80 overflow-y-auto p-4">{generatedNote.markdown}</RichMarkdown>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4 lg:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex gap-3"><div className="rounded-lg bg-amber-200/10 p-2 text-amber-100"><FileTextIcon size={18} /></div><div><h2 className="text-sm font-semibold">Cheat sheet</h2><p className="mt-1 text-xs text-white/42">Set the physical constraints before generating.</p></div></div>
                {generatedCheat && <button className={buttonClass} onClick={() => window.print()} type="button"><PrinterIcon size={15} /> Print</button>}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2"><FieldLabel htmlFor="cheat-title">Title</FieldLabel><input id="cheat-title" className={inputClass} onChange={(event) => setCheatTitle(event.target.value)} placeholder={`${subjectName} cheat sheet`} value={cheatTitle} /></div>
                <RestrictionNumber label="Physical sheets" max={10} min={1} onChange={(physicalSheetCount) => updateRestrictions({ physicalSheetCount })} value={restrictions.physicalSheetCount} />
                <div><FieldLabel>Printing</FieldLabel><label className="flex h-[38px] items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 text-xs text-white/70"><input checked={restrictions.doubleSided} className="accent-emerald-200" onChange={(event) => updateRestrictions({ doubleSided: event.target.checked })} type="checkbox" /> Double-sided</label></div>
                <RestrictionSelect label="Paper" onChange={(paperSize) => updateRestrictions({ paperSize: paperSize as CheatSheetRestrictions["paperSize"] })} options={["Letter", "A4"]} value={restrictions.paperSize} />
                <RestrictionSelect label="Orientation" onChange={(orientation) => updateRestrictions({ orientation: orientation as CheatSheetRestrictions["orientation"] })} options={["portrait", "landscape"]} value={restrictions.orientation} />
                <RestrictionSelect label="Font" onChange={(fontFamily) => updateRestrictions({ fontFamily: fontFamily as CheatSheetRestrictions["fontFamily"] })} options={["Inter", "Arial", "Georgia", "Times New Roman", "Courier New"]} value={restrictions.fontFamily} />
                <RestrictionNumber label="Font size (pt)" max={16} min={6} onChange={(fontSize) => updateRestrictions({ fontSize })} step={0.5} value={restrictions.fontSize} />
                <RestrictionNumber label="Margins (in)" max={1} min={0.15} onChange={(margins) => updateRestrictions({ margins })} step={0.05} value={restrictions.margins} />
                <RestrictionNumber label="Columns" max={4} min={1} onChange={(columns) => updateRestrictions({ columns })} value={restrictions.columns} />
                <RestrictionNumber label="Line spacing" max={2} min={0.8} onChange={(lineSpacing) => updateRestrictions({ lineSpacing })} step={0.05} value={restrictions.lineSpacing} />
                <div className="sm:col-span-2 lg:col-span-4"><FieldLabel htmlFor="professor-instructions">Professor instructions</FieldLabel><textarea id="professor-instructions" className={`${inputClass} min-h-20 resize-y`} onChange={(event) => setProfessorInstructions(event.target.value)} placeholder="Allowed content, prohibited topics, required notation..." value={professorInstructions} /></div>
              </div>
              <p className="mt-3 text-xs text-white/35">The preview creates {restrictions.physicalSheetCount * (restrictions.doubleSided ? 2 : 1)} printable side{restrictions.physicalSheetCount * (restrictions.doubleSided ? 2 : 1) === 1 ? "" : "s"}. Select duplex printing in the system dialog when double-sided is required.</p>
              <div className="mt-4 flex justify-end"><button className={primaryButtonClass} disabled={!canGenerate || loading !== null} onClick={() => void generateCheatSheet()} type="button">{loading === "cheat" && <SpinnerGapIcon className="animate-spin" size={15} />}Generate cheat sheet</button></div>
            </section>

            {generatedCheat && (
              <section className="subject-print-root rounded-xl border border-white/10 bg-[#151715] p-3 sm:p-5">
                <style media="print">{`@page { size: ${generatedCheat.restrictions.paperSize} ${generatedCheat.restrictions.orientation}; margin: 0; }`}</style>
                <div className="subject-no-print mb-4 flex items-center justify-between gap-3">
                  <div><h2 className="text-sm font-semibold">{generatedCheat.title}</h2><p className="mt-1 text-xs text-white/42">{generatedCheat.sides.length} generated side{generatedCheat.sides.length === 1 ? "" : "s"} · saved as an editable note</p></div>
                  <button className={buttonClass} onClick={() => openSavedDocument(generatedCheat.documentPath)} type="button"><ArrowSquareOutIcon size={14} /> Edit note</button>
                </div>
                <div className="subject-print-sides space-y-5">
                  {generatedCheat.sides.map((side) => <PaperSide key={side.number} markdown={side.markdown} number={side.number} restrictions={generatedCheat.restrictions} />)}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </section>
  );
}

function RestrictionSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <div><FieldLabel>{label}</FieldLabel><select className={inputClass} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></div>;
}

function RestrictionNumber({ label, max, min, onChange, step = 1, value }: { label: string; max: number; min: number; onChange: (value: number) => void; step?: number; value: number }) {
  return <div><FieldLabel>{label}</FieldLabel><input className={inputClass} max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} step={step} type="number" value={value} /></div>;
}

function PaperSide({ markdown, number, restrictions }: { markdown: string; number: number; restrictions: CheatSheetRestrictions }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [paperWidth, paperHeight] = restrictions.paperSize === "A4" ? [8.27, 11.69] : [8.5, 11];
  const width = restrictions.orientation === "portrait" ? paperWidth : paperHeight;
  const height = restrictions.orientation === "portrait" ? paperHeight : paperWidth;

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setOverflowing(content.scrollHeight > content.clientHeight + 2 || content.scrollWidth > content.clientWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [markdown, restrictions]);

  const style = {
    "--paper-width": `${width}in`,
    "--paper-height": `${height}in`,
    "--paper-ratio": `${width} / ${height}`,
    "--paper-margin": `${restrictions.margins}in`,
    "--paper-font": restrictions.fontFamily,
    "--paper-font-size": `${restrictions.fontSize}pt`,
    "--paper-columns": restrictions.columns,
    "--paper-leading": restrictions.lineSpacing,
  } as CSSProperties;

  return (
    <article className="subject-paper-wrap" style={style}>
      <div className="subject-no-print mb-1.5 flex items-center justify-between text-[11px] text-white/35"><span>Side {number}</span>{overflowing && <span className="rounded-full bg-red-300/10 px-2 py-0.5 text-red-200">Content overflows this side</span>}</div>
      <div className="subject-paper" data-side={number}>
        <div className="subject-paper-content" ref={contentRef}>
          <RichMarkdown>{markdown}</RichMarkdown>
        </div>
      </div>
    </article>
  );
}
