"use client";

export type CheatSheetRestrictions = {
  physicalSheetCount: number;
  doubleSided: boolean;
  paperSize: "Letter" | "A4";
  orientation: "portrait" | "landscape";
  fontFamily: "Inter" | "Arial" | "Georgia" | "Times New Roman" | "Courier New";
  fontSize: number;
  margins: number;
  columns: number;
  lineSpacing: number;
};

const storageKeyPrefix = "learner.subjectCheatSheet.restrictions.v2";

function storageKey(subjectPath: string) {
  return `${storageKeyPrefix}:${subjectPath || "default"}`;
}

export const defaultCheatSheetRestrictions: CheatSheetRestrictions = {
  physicalSheetCount: 1,
  doubleSided: true,
  paperSize: "Letter",
  orientation: "portrait",
  fontFamily: "Inter",
  fontSize: 9,
  margins: 0.35,
  columns: 2,
  lineSpacing: 1.15,
};

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number, step = 1) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.min(maximum, Math.max(minimum, parsed));
  return Math.round(bounded / step) * step;
}

export function normalizeCheatSheetRestrictions(value: unknown): CheatSheetRestrictions {
  const candidate = value && typeof value === "object" ? value as Partial<CheatSheetRestrictions> : {};
  const paperSizes = ["Letter", "A4"] as const;
  const orientations = ["portrait", "landscape"] as const;
  const fontFamilies = ["Inter", "Arial", "Georgia", "Times New Roman", "Courier New"] as const;

  return {
    physicalSheetCount: boundedNumber(candidate.physicalSheetCount, 1, 1, 10),
    doubleSided: typeof candidate.doubleSided === "boolean" ? candidate.doubleSided : true,
    paperSize: paperSizes.includes(candidate.paperSize as (typeof paperSizes)[number])
      ? candidate.paperSize as CheatSheetRestrictions["paperSize"]
      : "Letter",
    orientation: orientations.includes(candidate.orientation as (typeof orientations)[number])
      ? candidate.orientation as CheatSheetRestrictions["orientation"]
      : "portrait",
    fontFamily: fontFamilies.includes(candidate.fontFamily as (typeof fontFamilies)[number])
      ? candidate.fontFamily as CheatSheetRestrictions["fontFamily"]
      : "Inter",
    fontSize: boundedNumber(candidate.fontSize, 9, 6, 16, 0.5),
    margins: boundedNumber(candidate.margins, 0.35, 0.15, 1, 0.05),
    columns: boundedNumber(candidate.columns, 2, 1, 4),
    lineSpacing: boundedNumber(candidate.lineSpacing, 1.15, 0.8, 2, 0.05),
  };
}

export function readCheatSheetRestrictions(subjectPath = "") {
  if (typeof window === "undefined") return defaultCheatSheetRestrictions;
  try {
    const key = storageKey(subjectPath);
    const stored = localStorage.getItem(key);
    const normalized = normalizeCheatSheetRestrictions(stored ? JSON.parse(stored) : null);
    localStorage.setItem(key, JSON.stringify(normalized));
    return normalized;
  } catch {
    localStorage.setItem(storageKey(subjectPath), JSON.stringify(defaultCheatSheetRestrictions));
    return defaultCheatSheetRestrictions;
  }
}

export function writeCheatSheetRestrictions(value: CheatSheetRestrictions, subjectPath = "") {
  const normalized = normalizeCheatSheetRestrictions(value);
  if (typeof window !== "undefined") localStorage.setItem(storageKey(subjectPath), JSON.stringify(normalized));
  return normalized;
}
