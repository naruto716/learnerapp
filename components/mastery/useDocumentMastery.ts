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
type MasteryAssetsCardRequest = Omit<
  DocumentMasteryCardGenerationRequest,
  "documentPath" | "markdown" | "settings"
>;

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
  const [loadingDocumentPath, setLoadingDocumentPath] = useState<string | null>(null);
  const [isMetaphorLoading, setIsMetaphorLoading] = useState(false);
  const [metaphorLoadingDocumentPath, setMetaphorLoadingDocumentPath] = useState<string | null>(null);
  const [statusDocumentPath, setStatusDocumentPath] = useState<string | null>(null);
  const [metaphorProgress, setMetaphorProgress] = useState<MasteryMetaphorProgress | null>(null);
  const [mastery, setMastery] = useState<DocumentMastery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const masteryUpdateSequenceRef = useRef(0);
  const metaphorSequenceRef = useRef(0);
  const activeDocumentPathRef = useRef(activeDocumentPath);

  useEffect(() => {
    activeDocumentPathRef.current = activeDocumentPath;
    metaphorSequenceRef.current += 1;
  }, [activeDocumentPath]);

  useEffect(() => {
    return window.learner?.onMasteryMetaphorProgress?.((progress) => {
      if (!progress.documentPath || progress.documentPath !== activeDocumentPathRef.current) return;
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

  const generateMastery = useCallback(async (force = false, cardRequest?: MasteryAssetsCardRequest) => {
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
    setLoadingDocumentPath(documentSnapshot.path);
    setIsLoading(true);

    try {
      const request = {
        documentPath: documentSnapshot.path,
        force,
        markdown: documentSnapshot.markdown,
        settings: readAiSettings(),
      };
      const result = cardRequest
        ? await window.learner?.generateDocumentMasteryAssets({ ...request, cardRequest })
        : await window.learner?.generateDocumentMastery(request);
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

  const openMastery = useCallback(async (cardRequest?: MasteryAssetsCardRequest) => {
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
    setLoadingDocumentPath(documentSnapshot.path);
    setIsLoading(true);

    try {
      const cachedMastery = await window.learner?.getDocumentMastery(documentSnapshot.path, documentSnapshot.markdown);
      if (!cachedMastery) {
        throw new Error("Mastery extraction is not available in this renderer.");
      }

      if (cachedMastery.concepts.length > 0) {
        setMastery(cachedMastery);
        if (cardRequest) {
          return window.learner?.generateDocumentMasteryAssets({
            cardRequest,
            documentPath: documentSnapshot.path,
            force: false,
            markdown: documentSnapshot.markdown,
            settings: readAiSettings(),
          });
        }
        return { generated: false, mastery: cachedMastery };
      }

      const request = {
        documentPath: documentSnapshot.path,
        force: false,
        markdown: documentSnapshot.markdown,
        settings: readAiSettings(),
      };
      const result = cardRequest
        ? await window.learner?.generateDocumentMasteryAssets({ ...request, cardRequest })
        : await window.learner?.generateDocumentMastery(request);
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

  useEffect(() => {
    if (!activeDocumentPath) return;
    let cancelled = false;

    const applyStatus = (status: LearnerAiOperationStatus | null) => {
      if (!status || status.documentPath !== activeDocumentPathRef.current) return;
      setStatusDocumentPath(status.documentPath);

      if (status.operation === "mastery concept generation") {
        if (status.state === "running") setLoadingDocumentPath(status.documentPath);
        setIsLoading(status.state === "running");
        if (status.state === "failed") setError(status.error || "Mastery extraction failed.");
        if (status.state === "completed") void refreshMastery();
        return;
      }

      if (status.operation !== "metaphor generation") return;
      if (status.state === "running") setMetaphorLoadingDocumentPath(status.documentPath);
      setIsMetaphorLoading(status.state === "running");
      setMetaphorProgress(
        status.state === "completed" ? null : status.progress as MasteryMetaphorProgress | null,
      );
      if (status.state === "failed") setError(status.error || "Mastery metaphor generation failed.");
      if (status.state === "completed") void refreshMastery();
    };

    window.learner?.getDocumentMasteryGenerationStatuses(activeDocumentPath).then((statuses) => {
      if (cancelled) return;
      setStatusDocumentPath(activeDocumentPath);
      const conceptStatus = statuses.find((status) => status.operation === "mastery concept generation") ?? null;
      const metaphorStatus = statuses.find((status) => status.operation === "metaphor generation") ?? null;
      setError(null);
      setIsLoading(false);
      setIsMetaphorLoading(false);
      setMetaphorProgress(null);
      applyStatus(conceptStatus);
      applyStatus(metaphorStatus);
    });
    const removeStatusListener = window.learner?.onAiOperationStatus?.(applyStatus);

    return () => {
      cancelled = true;
      removeStatusListener?.();
    };
  }, [activeDocumentPath, refreshMastery]);

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
    const metaphorSequence = metaphorSequenceRef.current + 1;
    metaphorSequenceRef.current = metaphorSequence;
    const documentPath = validation.snapshot.path;
    setMetaphorLoadingDocumentPath(documentPath);
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

      if (metaphorSequenceRef.current === metaphorSequence && activeDocumentPathRef.current === documentPath) {
        setMastery(updatedMastery);
        setMetaphorProgress(null);
      }
      return true;
    } catch (metaphorError) {
      if (reportError && metaphorSequenceRef.current === metaphorSequence && activeDocumentPathRef.current === documentPath) {
        setError(metaphorError instanceof Error ? metaphorError.message : "Mastery metaphor generation failed.");
      }
      return false;
    } finally {
      if (metaphorSequenceRef.current === metaphorSequence && activeDocumentPathRef.current === documentPath) {
        setIsMetaphorLoading(false);
      }
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
    setLoadingDocumentPath(snapshot?.path ?? activeDocumentPath);
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
    isLoading: statusDocumentPath === activeDocumentPath && isLoading && loadingDocumentPath === activeDocumentPath,
    isMetaphorLoading: statusDocumentPath === activeDocumentPath
      && isMetaphorLoading
      && metaphorLoadingDocumentPath === activeDocumentPath,
    isOpen,
    mastery,
    metaphorProgress,
    openMastery,
    refreshMastery,
    updateConceptMasteryScore,
  };
}
