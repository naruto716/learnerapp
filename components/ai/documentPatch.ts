"use client";

export type ProposedDocumentPatch = {
  id: string;
  documentPath: string;
  baseHash: string;
  summary: string;
  changeType?: "patch" | "replace";
  patchText?: string;
  replacementMarkdown?: string;
  status: "pending" | "previewing" | "applied" | "rejected" | "error";
  error?: string;
  createdAt: number;
};

export type DocumentPatchApplyResult = {
  appliedOperations: number;
  failures: string[];
};

export type DocumentPatchPreviewHunk = {
  index: number;
  startLine: number;
  endLine: number;
  oldLines: string[];
  newLines: string[];
  removedLines: string[];
  removedLineIndexes: number[];
  addedLines: string[];
};

export type DocumentPatchPreviewResult = {
  failures: string[];
  hunks: DocumentPatchPreviewHunk[];
};

type PatchLine = {
  kind: "context" | "remove" | "add";
  text: string;
};

type ParsedHunk = {
  lines: PatchLine[];
};

type ParsedDocumentPatch = {
  documentPath: string;
  hunks: ParsedHunk[];
};

const beginPatch = "*** Begin Patch";
const endPatch = "*** End Patch";
const updateDocumentPrefix = "*** Update Document: ";

export function formatHtmlForDocumentPatch(html: string) {
  return html
    .replace(/(<\/li>)(<li\b)/g, "$1\n$2")
    .replace(/(<\/(?:p|h[1-6]|blockquote|pre|ul|ol)>)(<(?:(?:p|h[1-6]|blockquote|pre|ul|ol)\b))/g, "$1\n$2")
    .trim();
}

export function hashDocumentPatchBase(source: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseDocumentPatch(patchText: string): ParsedDocumentPatch {
  const lines = patchText.replace(/\r\n/g, "\n").trim().split("\n");
  const failures: string[] = [];

  if (lines[0] !== beginPatch) {
    failures.push(`Patch must start with "${beginPatch}".`);
  }

  if (lines.at(-1) !== endPatch) {
    failures.push(`Patch must end with "${endPatch}".`);
  }

  const updateLine = lines[1] ?? "";
  if (!updateLine.startsWith(updateDocumentPrefix)) {
    failures.push(`Patch must include "${updateDocumentPrefix}<path>" after the begin line.`);
  }

  const documentPath = updateLine.slice(updateDocumentPrefix.length).trim();
  const hunks: ParsedHunk[] = [];
  let currentHunk: ParsedHunk | null = null;

  for (const [index, line] of lines.slice(2, -1).entries()) {
    const lineNumber = index + 3;

    if (line === "@@") {
      currentHunk = { lines: [] };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      failures.push(`Line ${lineNumber}: expected "@@" before patch lines.`);
      continue;
    }

    const prefix = line[0];
    const text = line.slice(1);

    if (prefix === " ") {
      currentHunk.lines.push({ kind: "context", text });
    } else if (prefix === "-") {
      currentHunk.lines.push({ kind: "remove", text });
    } else if (prefix === "+") {
      currentHunk.lines.push({ kind: "add", text });
    } else {
      failures.push(`Line ${lineNumber}: patch lines must start with space, "-", or "+".`);
    }
  }

  if (hunks.length === 0) {
    failures.push("Patch must contain at least one hunk.");
  }

  hunks.forEach((hunk, index) => {
    const removes = hunk.lines.some((line) => line.kind === "remove");
    const adds = hunk.lines.some((line) => line.kind === "add");
    const oldLines = hunk.lines.filter((line) => line.kind !== "add");

    if (!removes && !adds) {
      failures.push(`Hunk ${index + 1}: must add or remove at least one line.`);
    }

    if (oldLines.length === 0) {
      failures.push(`Hunk ${index + 1}: must include context or removed lines to anchor the edit.`);
    }
  });

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  return {
    documentPath,
    hunks,
  };
}

function findSequence(sourceLines: string[], needleLines: string[]) {
  const matches: number[] = [];

  if (needleLines.length === 0 || needleLines.length > sourceLines.length) {
    return matches;
  }

  for (let index = 0; index <= sourceLines.length - needleLines.length; index += 1) {
    const matched = needleLines.every((line, offset) => sourceLines[index + offset] === line);

    if (matched) {
      matches.push(index);
    }
  }

  return matches;
}

function resolvePatchHunks({
  currentSource,
  expectedDocumentPath,
  patchText,
}: {
  currentSource: string;
  expectedDocumentPath: string;
  patchText: string;
}) {
  const parsedPatch = parseDocumentPatch(patchText);
  const failures: string[] = [];

  if (parsedPatch.documentPath !== expectedDocumentPath) {
    return {
      appliedOperations: 0,
      failures: [`Patch targets ${parsedPatch.documentPath}, but ${expectedDocumentPath} is currently open.`],
      patchedSource: currentSource,
      hunks: [],
    };
  }

  let sourceLines = currentSource.split("\n");
  let appliedOperations = 0;
  const hunks: DocumentPatchPreviewHunk[] = [];

  parsedPatch.hunks.forEach((hunk, index) => {
    if (failures.length > 0) return;

    const oldLines = hunk.lines.filter((line) => line.kind !== "add").map((line) => line.text);
    const newLines = hunk.lines.filter((line) => line.kind !== "remove").map((line) => line.text);
    const removedLines = hunk.lines.filter((line) => line.kind === "remove").map((line) => line.text);
    const addedLines = hunk.lines.filter((line) => line.kind === "add").map((line) => line.text);
    const removedLineIndexes: number[] = [];
    let oldLineOffset = 0;

    hunk.lines.forEach((line) => {
      if (line.kind === "add") return;

      if (line.kind === "remove") {
        removedLineIndexes.push(oldLineOffset);
      }

      oldLineOffset += 1;
    });

    const matches = findSequence(sourceLines, oldLines);

    if (matches.length === 0) {
      failures.push(`Hunk ${index + 1}: context was not found in the current document.`);
      return;
    }

    if (matches.length > 1) {
      failures.push(`Hunk ${index + 1}: context matched multiple locations. Add more context.`);
      return;
    }

    hunks.push({
      index: index + 1,
      startLine: matches[0],
      endLine: matches[0] + oldLines.length,
      oldLines,
      newLines,
      removedLines,
      removedLineIndexes,
      addedLines,
    });

    sourceLines = [
      ...sourceLines.slice(0, matches[0]),
      ...newLines,
      ...sourceLines.slice(matches[0] + oldLines.length),
    ];
    appliedOperations += 1;
  });

  return {
    appliedOperations,
    failures,
    hunks,
    patchedSource: failures.length > 0 ? currentSource : sourceLines.join("\n"),
  };
}

export function previewDocumentPatchText({
  currentSource,
  expectedDocumentPath,
  patchText,
}: {
  currentSource: string;
  expectedDocumentPath: string;
  patchText: string;
}): DocumentPatchPreviewResult {
  const result = resolvePatchHunks({
    currentSource,
    expectedDocumentPath,
    patchText,
  });

  return {
    failures: result.failures,
    hunks: result.hunks,
  };
}

export function applyDocumentPatchText({
  currentSource,
  expectedDocumentPath,
  patchText,
}: {
  currentSource: string;
  expectedDocumentPath: string;
  patchText: string;
}) {
  const result = resolvePatchHunks({
    currentSource,
    expectedDocumentPath,
    patchText,
  });

  return {
    appliedOperations: result.appliedOperations,
    failures: result.failures,
    patchedSource: result.patchedSource,
  };
}
