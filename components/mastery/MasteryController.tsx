"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { toast } from "sonner";
import FloatingIconButton from "@/components/FloatingIconButton";
import type { FloatingIconButtonStatus } from "@/components/FloatingIconButton";
import type { AgentForegroundContext } from "@/components/ai/agentForegroundContext";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import MasteryPanel from "./MasteryPanel";
import { readMasterySettings } from "./masterySettings";
import { useDocumentMastery } from "./useDocumentMastery";
import { useMasteryCards } from "./useMasteryCards";

type MasteryControllerProps = {
  activeDocumentPath: string | null;
  documentContentHash?: string;
  editorToolsVersion?: number;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  hidden?: boolean;
  isSidebarOpen: boolean;
  onForegroundContextChange?: (context: AgentForegroundContext | null) => void;
  onOpenChange?: (open: boolean) => void;
};

export default function MasteryController({
  activeDocumentPath,
  documentContentHash,
  editorToolsVersion,
  getCurrentDocumentTools,
  hidden = false,
  isSidebarOpen,
  onForegroundContextChange,
  onOpenChange,
}: MasteryControllerProps) {
  const masteryController = useDocumentMastery({
    activeDocumentPath,
    documentContentHash,
    editorToolsVersion,
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

  const masteryAssetsCardRequest = () => {
    const preferences = cardsController.cardState?.preferences ?? {
      generationPrompt: "",
      targetProficiency: "proficient" as const,
    };
    return {
      generationPrompt: preferences.generationPrompt,
      masterySettings: readMasterySettings(),
      targetProficiency: preferences.targetProficiency,
    };
  };

  const generateMasteryAssets = async (force = false) => {
    return Boolean(await generateMastery(force, masteryAssetsCardRequest()));
  };

  const openAndPrepareMastery = async () => {
    return Boolean(await openMastery());
  };

  const masteryIsCurrentDocument = mastery?.documentPath === activeDocumentPath;
  const cardState = cardsController.cardState;
  const cardsAreCurrentDocument = cardState?.documentPath === activeDocumentPath;
  const masteryIsGenerating = isLoading || isMetaphorLoading || cardsController.isGenerating;
  const masteryStatus: FloatingIconButtonStatus = masteryIsGenerating
    ? "generating"
    : !masteryIsCurrentDocument || !cardsAreCurrentDocument
      ? "checking"
      : mastery.stale || Boolean(mastery.metaphor?.stale)
        ? "notes-changed"
        : mastery.concepts.length > 0 && Boolean(mastery.metaphor) && cardState.cards.length > 0
          ? "ready"
          : "not-generated";
  const masteryStatusLabel = {
    checking: "Checking status",
    "not-generated": "Not generated",
    generating: "Generating",
    ready: "Ready",
    "notes-changed": "Notes changed",
  }[masteryStatus];

  const handleMasteryButton = () => {
    if (masteryStatus === "ready" || masteryStatus === "notes-changed") {
      void openAndPrepareMastery();
      return;
    }
    if (masteryStatus === "generating") {
      toast.info("Mastery generation is already in progress.", { id: "mastery-generation-status" });
      return;
    }
    if (masteryStatus === "checking") {
      toast.info("Checking Mastery status.", { id: "mastery-generation-status" });
      return;
    }

    toast.info("Mastery generation started.", { id: "mastery-generation-status" });
    void generateMastery(false, masteryAssetsCardRequest(), false);
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
          icon={<SparkleIcon size={16} className={masteryStatus === "generating" ? "animate-pulse" : ""} />}
          onClick={handleMasteryButton}
          size={8}
          status={masteryStatus}
          tooltip={`Mastery · ${masteryStatusLabel}`}
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
        key={`${activeDocumentPath ?? "none"}:${isOpen ? "open" : "closed"}`}
        mastery={mastery}
        metaphorProgress={metaphorProgress}
        onClear={clearAndSyncCards}
        onClearCards={cardsController.clearCards}
        onClose={closeMastery}
        onGenerateCards={cardsController.generateCards}
        onGenerateMetaphor={generateMetaphor}
        onForegroundContextChange={onForegroundContextChange}
        onPracticeChanged={syncAfterPractice}
        onMasteryScoreChange={updateConceptMasteryScore}
        onGenerate={generateMasteryAssets}
        readCurrentDocumentMarkdown={readCurrentDocumentMarkdown}
        open={isOpen}
      />
    </>
  );
}
