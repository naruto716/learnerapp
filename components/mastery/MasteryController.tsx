"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import FloatingIconButton from "@/components/FloatingIconButton";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import MasteryPanel from "./MasteryPanel";
import { useDocumentMastery } from "./useDocumentMastery";
import { useMasteryCards } from "./useMasteryCards";

type MasteryControllerProps = {
  activeDocumentPath: string | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  hidden?: boolean;
  isSidebarOpen: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function MasteryController({
  activeDocumentPath,
  getCurrentDocumentTools,
  hidden = false,
  isSidebarOpen,
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

  const generateAndSyncCards = async (force = false) => {
    const generated = await generateMastery(force);
    if (generated) await cardsController.loadCards();
    return generated;
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
            void openMastery();
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
        onGenerateCards={cardsController.generateCards}
        onGenerateMetaphor={generateMetaphor}
        onPracticeChanged={syncAfterPractice}
        onMasteryScoreChange={updateConceptMasteryScore}
        onGenerate={generateAndSyncCards}
        readCurrentDocumentMarkdown={readCurrentDocumentMarkdown}
        open={isOpen}
      />
    </>
  );
}
