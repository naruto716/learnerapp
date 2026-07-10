"use client";

import { useCallback, useEffect, useState } from "react";
import { readAiSettings } from "@/components/ai/aiSettings";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import { readMasterySettings } from "./masterySettings";

type UseMasteryCardsOptions = {
  activeDocumentPath: string | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  isOpen: boolean;
  onMasteryChanged: () => Promise<unknown>;
};

export function useMasteryCards({
  activeDocumentPath,
  getCurrentDocumentTools,
  isOpen,
  onMasteryChanged,
}: UseMasteryCardsOptions) {
  const [cardState, setCardState] = useState<DocumentMasteryCards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [progress, setProgress] = useState<MasteryCardProgress | null>(null);

  useEffect(() => {
    return window.learner?.onMasteryCardProgress?.((nextProgress) => {
      setProgress(nextProgress);
    });
  }, []);

  const loadCards = useCallback(async () => {
    if (!activeDocumentPath) {
      setCardState(null);
      return null;
    }

    try {
      setError(null);
      const state = await window.learner?.getDocumentMasteryCards(activeDocumentPath);
      if (!state) throw new Error("Mastery flashcards are not available in this renderer.");
      setCardState(state);
      return state;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load mastery flashcards.");
      return null;
    }
  }, [activeDocumentPath]);

  useEffect(() => {
    if (!isOpen || !activeDocumentPath) return;
    let cancelled = false;

    window.learner
      ?.getDocumentMasteryCards(activeDocumentPath)
      .then((state) => {
        if (!cancelled && state) {
          setError(null);
          setCardState(state);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load mastery flashcards.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDocumentPath, isOpen]);

  const generateCards = useCallback(async (preferences: MasteryCardPreferences) => {
    setError(null);
    setIsGenerating(true);
    setProgress({ completed: 0, label: "Preparing flashcard generation", phase: "planning", total: 1 });
    setCardState((current) => (current ? { ...current, preferences } : current));

    try {
      const snapshot = getCurrentDocumentTools()?.read();
      if (!snapshot || !activeDocumentPath) throw new Error("Open a document before generating flashcards.");
      const state = await window.learner?.generateDocumentMasteryCards({
        documentPath: snapshot.path,
        generationPrompt: preferences.generationPrompt,
        markdown: snapshot.markdown,
        masterySettings: readMasterySettings(),
        settings: readAiSettings(),
        targetProficiency: preferences.targetProficiency,
      });
      if (!state) throw new Error("Flashcard generation is not available in this renderer.");
      setCardState(state);
      return true;
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Flashcard generation failed.");
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools]);

  const evaluateCard = useCallback(async (cardId: number, answerMarkdown = "") => {
    setError(null);
    setIsEvaluating(true);

    try {
      const snapshot = getCurrentDocumentTools()?.read();
      if (!snapshot || !activeDocumentPath) throw new Error("Open a document before answering flashcards.");
      const state = await window.learner?.evaluateMasteryCard({
        answerMarkdown,
        cardId,
        documentPath: snapshot.path,
        markdown: snapshot.markdown,
        masterySettings: readMasterySettings(),
        settings: readAiSettings(),
      });
      if (!state) throw new Error("Flashcard evaluation is not available in this renderer.");
      setCardState(state);
      await onMasteryChanged();
      return true;
    } catch (evaluationError) {
      setError(evaluationError instanceof Error ? evaluationError.message : "Flashcard evaluation failed.");
      return false;
    } finally {
      setIsEvaluating(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools, onMasteryChanged]);

  const continueDiscussion = useCallback(async (cardId: number, message: string) => {
    setError(null);
    setIsDiscussing(true);

    try {
      const snapshot = getCurrentDocumentTools()?.read();
      if (!snapshot || !activeDocumentPath) throw new Error("Open a document before continuing the drill.");
      const result = await window.learner?.continueMasteryCardDiscussion({
        cardId,
        documentPath: snapshot.path,
        markdown: snapshot.markdown,
        message,
        settings: readAiSettings(),
      });
      if (!result) throw new Error("The multi-turn drill is not available in this renderer.");
      setCardState(result.state);

      if (result.shouldEnd) {
        await evaluateCard(cardId);
      }
      return result.shouldEnd;
    } catch (discussionError) {
      setError(discussionError instanceof Error ? discussionError.message : "Could not continue the drill.");
      return false;
    } finally {
      setIsDiscussing(false);
    }
  }, [activeDocumentPath, evaluateCard, getCurrentDocumentTools]);

  const clearCards = useCallback(async () => {
    setError(null);

    try {
      if (!activeDocumentPath) throw new Error("Open a document before clearing flashcards.");
      const state = await window.learner?.clearDocumentMasteryCards({
        documentPath: activeDocumentPath,
        resetProgress: true,
      });
      if (!state) throw new Error("Flashcard clearing is not available in this renderer.");
      setCardState(state);
      setProgress(null);
      await onMasteryChanged();
      return true;
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Could not clear flashcards.");
      return false;
    }
  }, [activeDocumentPath, onMasteryChanged]);

  return {
    cardState,
    clearCards,
    continueDiscussion,
    error,
    evaluateCard,
    generateCards,
    isDiscussing,
    isEvaluating,
    isGenerating,
    loadCards,
    progress,
  };
}
