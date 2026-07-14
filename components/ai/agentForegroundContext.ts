export type AgentForegroundContext =
  | {
      key: string;
      kind: "selection";
      label: string;
      documentPath: string;
      selectedText: string;
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
