"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import { readAiSettings } from "@/components/ai/aiSettings";
import { readMasterySettings } from "./masterySettings";

type UseDocumentMasteryOptions = {
  activeDocumentPath: string | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  onOpenChange?: (open: boolean) => void;
};

type DocumentSnapshot = ReturnType<CurrentDocumentAgentTools["read"]>;

function readValidSnapshot(
  activeDocumentPath: string | null,
  tools: CurrentDocumentAgentTools | null,
  action: "extracting" | "viewing",
): { error: string; snapshot: null } | { error: null; snapshot: DocumentSnapshot } {
  if (!activeDocumentPath) {
    return {
      error:
        action === "extracting"
          ? "Open a document before extracting mastery concepts."
          : "Open a document before viewing mastery concepts.",
      snapshot: null,
    };
  }

  if (!tools) {
    return {
      error: "The active editor is not ready yet.",
      snapshot: null,
    };
  }

  const snapshot = tools.read();
  if (!snapshot.markdown.trim()) {
    return {
      error: "This document is empty, so there is nothing to extract yet.",
      snapshot: null,
    };
  }

  return {
    error: null,
    snapshot,
  };
}

export function useDocumentMastery({
  activeDocumentPath,
  getCurrentDocumentTools,
  onOpenChange,
}: UseDocumentMasteryOptions) {
  const [isOpen, setIsOpenState] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMetaphorLoading, setIsMetaphorLoading] = useState(false);
  const [metaphorProgress, setMetaphorProgress] = useState<MasteryMetaphorProgress | null>(null);
  const [mastery, setMastery] = useState<DocumentMastery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const masteryUpdateSequenceRef = useRef(0);

  useEffect(() => {
    return window.learner?.onMasteryMetaphorProgress?.((progress) => {
      setMetaphorProgress(progress);
    });
  }, []);

  const setIsOpen = useCallback(
    (nextOpen: boolean) => {
      setIsOpenState(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const generateMastery = useCallback(async (force = false) => {
    setIsOpen(true);
    setError(null);
    setMetaphorProgress(null);

    const tools = getCurrentDocumentTools();
    const validation = readValidSnapshot(activeDocumentPath, tools, "extracting");
    if (validation.snapshot === null) {
      setMastery(null);
      setError(validation.error);
      return null;
    }

    const documentSnapshot = validation.snapshot;
    setIsLoading(true);

    try {
      const result = await window.learner?.generateDocumentMastery({
        documentPath: documentSnapshot.path,
        force,
        markdown: documentSnapshot.markdown,
        settings: readAiSettings(),
      });
      if (!result) {
        throw new Error("Mastery extraction is not available in this renderer.");
      }

      setMastery(result.mastery);
      return result;
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Mastery extraction failed.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools, setIsOpen]);

  const openMastery = useCallback(async () => {
    setIsOpen(true);
    setError(null);

    const tools = getCurrentDocumentTools();
    const validation = readValidSnapshot(activeDocumentPath, tools, "viewing");
    if (validation.snapshot === null) {
      setMastery(null);
      setError(validation.error);
      return;
    }

    const documentSnapshot = validation.snapshot;
    setIsLoading(true);

    try {
      const cachedMastery = await window.learner?.getDocumentMastery(documentSnapshot.path, documentSnapshot.markdown);
      if (!cachedMastery) {
        throw new Error("Mastery extraction is not available in this renderer.");
      }

      if (cachedMastery.concepts.length > 0) {
        setMastery(cachedMastery);
        return { generated: false, mastery: cachedMastery };
      }

      const result = await window.learner?.generateDocumentMastery({
        documentPath: documentSnapshot.path,
        force: false,
        markdown: documentSnapshot.markdown,
        settings: readAiSettings(),
      });
      if (!result) {
        throw new Error("Mastery extraction is not available in this renderer.");
      }

      setMastery(result.mastery);
      return result;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Mastery extraction failed.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools, setIsOpen]);

  const updateConceptMasteryScore = useCallback(async (conceptId: number, score: number) => {
    setError(null);

    const tools = getCurrentDocumentTools();
    const validation = readValidSnapshot(activeDocumentPath, tools, "viewing");
    if (validation.snapshot === null) {
      setError(validation.error);
      return;
    }

    const previousMastery = mastery;
    if (previousMastery) {
      setMastery({
        ...previousMastery,
        concepts: previousMastery.concepts.map((concept) =>
          concept.id === conceptId
            ? {
                ...concept,
                overallScore: score,
                masteryRationale: "Set manually by you.",
                stageStates: concept.stageStates.map((stageState) => ({ ...stageState, score })),
                updatedAt: Date.now(),
              }
            : concept,
        ),
      });
    }

    const updateSequence = masteryUpdateSequenceRef.current + 1;
    masteryUpdateSequenceRef.current = updateSequence;

    try {
      const updatedMastery = await window.learner?.updateDocumentMasteryConceptScore({
        conceptId,
        documentPath: validation.snapshot.path,
        markdown: validation.snapshot.markdown,
        masterySettings: readMasterySettings(),
        score,
      });
      if (!updatedMastery) {
        throw new Error("Mastery editing is not available in this renderer.");
      }

      if (masteryUpdateSequenceRef.current === updateSequence) {
        setMastery(updatedMastery);
      }
    } catch (updateError) {
      if (previousMastery && masteryUpdateSequenceRef.current === updateSequence) {
        setMastery(previousMastery);
      }
      if (masteryUpdateSequenceRef.current === updateSequence) {
        setError(updateError instanceof Error ? updateError.message : "Mastery update failed.");
      }
    }
  }, [activeDocumentPath, getCurrentDocumentTools, mastery]);

  const refreshMastery = useCallback(async () => {
    const tools = getCurrentDocumentTools();
    const validation = readValidSnapshot(activeDocumentPath, tools, "viewing");
    if (validation.snapshot === null) return null;

    const refreshed = await window.learner?.getDocumentMastery(
      validation.snapshot.path,
      validation.snapshot.markdown,
    );
    if (refreshed) setMastery(refreshed);
    return refreshed ?? null;
  }, [activeDocumentPath, getCurrentDocumentTools]);

  const generateMetaphor = useCallback(async (sourceMastery?: DocumentMastery, reportError = true) => {
    if (reportError) setError(null);

    const tools = getCurrentDocumentTools();
    const validation = readValidSnapshot(activeDocumentPath, tools, "viewing");
    if (validation.snapshot === null) {
      if (reportError) setError(validation.error);
      return false;
    }

    if (!(sourceMastery ?? mastery)?.concepts.length) {
      if (reportError) setError("Extract mastery concepts before generating a metaphor.");
      return false;
    }

    setIsMetaphorLoading(true);
    setMetaphorProgress({
      completed: 0,
      failed: 0,
      label: "Starting metaphor generation",
      phase: "planning",
      total: 1,
    });

    try {
      const updatedMastery = await window.learner?.generateDocumentMasteryMetaphor({
        documentPath: validation.snapshot.path,
        markdown: validation.snapshot.markdown,
        settings: readAiSettings(),
      });
      if (!updatedMastery) {
        throw new Error("Mastery metaphor generation is not available in this renderer.");
      }

      setMastery(updatedMastery);
      return true;
    } catch (metaphorError) {
      if (reportError) {
        setError(metaphorError instanceof Error ? metaphorError.message : "Mastery metaphor generation failed.");
      }
      return false;
    } finally {
      setIsMetaphorLoading(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools, mastery]);

  const clearMastery = useCallback(async () => {
    setError(null);
    setMetaphorProgress(null);

    if (!activeDocumentPath) {
      setError("Open a document before clearing mastery concepts.");
      return false;
    }

    const snapshot = getCurrentDocumentTools()?.read();
    setIsLoading(true);
    setIsMetaphorLoading(false);

    try {
      const clearedMastery = await window.learner?.clearDocumentMastery({
        documentPath: snapshot?.path ?? activeDocumentPath,
        markdown: snapshot?.markdown ?? "",
      });
      if (!clearedMastery) {
        throw new Error("Mastery clearing is not available in this renderer.");
      }

      setMastery(clearedMastery);
      return true;
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Mastery clearing failed.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools]);

  const closeMastery = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  return {
    closeMastery,
    clearMastery,
    error,
    generateMastery,
    generateMetaphor,
    isLoading,
    isMetaphorLoading,
    isOpen,
    mastery,
    metaphorProgress,
    openMastery,
    refreshMastery,
    updateConceptMasteryScore,
  };
}
