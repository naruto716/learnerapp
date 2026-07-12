"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { toast } from "sonner";
import FloatingIconButton from "@/components/FloatingIconButton";
import type { AgentForegroundContext } from "@/components/ai/agentForegroundContext";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import MasteryPanel from "./MasteryPanel";
import { readMasterySettings } from "./masterySettings";
import { useDocumentMastery } from "./useDocumentMastery";
import { useMasteryCards } from "./useMasteryCards";

type MasteryControllerProps = {
  activeDocumentPath: string | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  hidden?: boolean;
  isSidebarOpen: boolean;
  onForegroundContextChange?: (context: AgentForegroundContext | null) => void;
  onOpenChange?: (open: boolean) => void;
};

export default function MasteryController({
  activeDocumentPath,
  getCurrentDocumentTools,
  hidden = false,
  isSidebarOpen,
  onForegroundContextChange,
  onOpenChange,
}: MasteryControllerProps) {
  const masteryController = useDocumentMastery({
    activeDocumentPath,
    getCurrentDocumentTools,
    onOpenChange,
  });
  const {
    clearMastery,
    closeMastery,
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
  } = masteryController;
  const cardsController = useMasteryCards({
    activeDocumentPath,
    getCurrentDocumentTools,
    isOpen,
    onMasteryChanged: refreshMastery,
  });

  const startInitialMasteryJobs = (result: DocumentMasteryGenerationResult) => {
    if (!result.generated) return;

    const metaphorJob = generateMetaphor(result.mastery, false).then((generated) => {
      if (!generated) toast.error("Metaphor generation failed. You can generate it manually from Mastery.");
    });
    const cardJob = cardsController.ensureReadyCards(readMasterySettings().practiceCardCount, false).then((state) => {
      if (!state) {
        toast.error("Knowledge graph or flashcard generation failed. You can generate cards manually from Mastery.");
      }
    });
    void Promise.allSettled([metaphorJob, cardJob]);
  };

  const generateAndSyncCards = async (force = false) => {
    const result = await generateMastery(force);
    if (!result) return false;
    startInitialMasteryJobs(result);
    return true;
  };

  const openAndPrepareMastery = async () => {
    const result = await openMastery();
    if (!result) return false;
    startInitialMasteryJobs(result);
    return true;
  };

  const clearAndSyncCards = async () => {
    const cleared = await clearMastery();
    if (cleared) await cardsController.loadCards();
    return cleared;
  };

  const readCurrentDocumentMarkdown = useCallback(
    () => getCurrentDocumentTools()?.read().markdown ?? "",
    [getCurrentDocumentTools],
  );
  const loadCards = cardsController.loadCards;

  const syncAfterPractice = useCallback(async () => {
    await Promise.all([loadCards(), refreshMastery()]);
  }, [loadCards, refreshMastery]);

  return (
    <>
      {activeDocumentPath && !hidden && !isOpen && (
        <FloatingIconButton
          ariaLabel="Open mastery"
          className="right-16 top-15"
          disabled={isLoading}
          icon={<SparkleIcon size={16} className={isLoading ? "animate-pulse" : ""} />}
          onClick={() => {
            void openAndPrepareMastery();
          }}
          size={8}
          tooltip={isLoading ? "Building mastery" : "Mastery"}
        />
      )}
      <MasteryPanel
        activeDocumentPath={activeDocumentPath}
        cardError={cardsController.error}
        cardProgress={cardsController.progress}
        cardState={cardsController.cardState}
        error={error}
        isCardGenerating={cardsController.isGenerating}
        isMetaphorLoading={isMetaphorLoading}
        isLoading={isLoading}
        isSidebarOpen={isSidebarOpen}
        mastery={mastery}
        metaphorProgress={metaphorProgress}
        onClear={clearAndSyncCards}
        onClearCards={cardsController.clearCards}
        onClose={closeMastery}
        onEnsureReadyCards={cardsController.ensureReadyCards}
        onGenerateCards={cardsController.generateCards}
        onGenerateMetaphor={generateMetaphor}
        onForegroundContextChange={onForegroundContextChange}
        onPracticeChanged={syncAfterPractice}
        onMasteryScoreChange={updateConceptMasteryScore}
        onGenerate={generateAndSyncCards}
        readCurrentDocumentMarkdown={readCurrentDocumentMarkdown}
        open={isOpen}
      />
    </>
  );
}
