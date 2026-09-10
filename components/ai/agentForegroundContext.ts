export type AgentForegroundContext =
  | {
      key: string;
      kind: "selection";
      label: string;
      documentPath: string;
      selectedText: string;
      surroundingText?: string;
    }
  | {
      key: string;
      kind: "concept";
      label: string;
      documentPath: string;
      concept: MasteryConcept;
      metaphorScene: MasteryMetaphorConceptScene | null;
    }
  | {
      key: string;
      kind: "card";
      label: string;
      documentPath: string;
      card: MasteryCard;
      stageStates: MasteryStageState[];
      weaknesses: MasteryWeakness[];
    }
  | {
      key: string;
      kind: "answer";
      label: string;
      documentPath: string;
      sessionId: number;
      sessionCard: MasteryPracticeSessionCard;
    };

export function foregroundContextDescription(context: AgentForegroundContext) {
  if (context.kind === "selection") return context.label;
  if (context.kind === "concept") return `Concept: ${context.concept.name}`;
  if (context.kind === "card") return `Flashcard: ${context.card.title}`;
  return `Answer: ${context.sessionCard.card.title}`;
}

export type ForegroundContextBadge = {
  key: string;
  label: string;
};

export function foregroundContextBadges(context: AgentForegroundContext): ForegroundContextBadge[] {
  if (context.kind !== "selection") {
    return [{ key: context.key, label: foregroundContextDescription(context) }];
  }

  const badges: ForegroundContextBadge[] = [
    { key: `${context.key}:selected`, label: "Selected text" },
  ];

  if (context.surroundingText?.trim()) {
    badges.push({ key: `${context.key}:surrounding`, label: "Surrounding text" });
  }

  return badges;
}
// Foreground context describes transient editor, mastery, or revision material attached to one chat turn.
