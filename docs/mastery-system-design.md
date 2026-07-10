# Mastery Flashcard System

- Status: active product specification
- Scope: product behavior
- Current slice: card generation, practice, evaluation, mastery points, and weaknesses
- Deferred: long-term scheduling and review planning

## Product Purpose

The mastery system turns the detailed concepts extracted from one note into adaptive practice. It is not a conventional front-and-back flashcard deck and it should not force every subject through the same sequence of exercises.

The user chooses a target proficiency for each note. The system then generates additional cards from:

- the note's concepts
- current mastery evidence
- active weaknesses
- existing cards and attempts
- the knowledge graph when relationships are useful
- the shared metaphor when a Feynman card is useful
- the user's learning profile
- the note's persistent generation prompt

## Note Learning Goal

Each note retains:

- target proficiency
- generation prompt

The default target is **Proficient**. Opening card generation again shows the saved values. The user may change either value before generating more cards.

Generation always adds cards. It does not replace the existing deck. Clearing the deck is a separate, explicit action.

Example generation prompts:

- Generate more mathematical derivation drills.
- Focus on production failure diagnosis.
- Avoid basic definitions; test research-level tradeoffs.
- Work on the weaknesses exposed in my last attempts.

## Learning Evidence

Every concept tracks a `0-100` score for five evidence dimensions:

- Stage 2: plain comprehension
- Stage 3: connections and usable mental models
- Stage 4: relationships and distinctions
- Stage 5: fault finding and reliable execution
- Stage 6: transfer to difficult new situations

These stages are evidence labels, not card categories. A card type is never selected because it belongs to a particular stage. The generator chooses the interaction that fits the concept and records every concept-stage pair that a successful answer actually demonstrates.

Examples:

- A LeetCode pattern may need many drills and transfer problems.
- A history concept may need more relationship and contrast cards.
- A simple definition with difficult operational consequences may need debugging cards early.
- One card may demonstrate several stages or several concepts when the task genuinely requires all of them.

The same mastery points are applied to every targeted concept-stage pair. Credit is not divided between targets.

## Mastery Scale

Overall concept mastery is the arithmetic mean of Stages 2 through 6:

```text
overall = round((stage2 + stage3 + stage4 + stage5 + stage6) / 5)
```

Default level thresholds are:

| Level | Score |
| --- | ---: |
| Familiar | 25 |
| Developing | 50 |
| Proficient | 80 |
| Advanced | 90 |
| Mastered | 95 |

The thresholds are editable in Settings. The visible mastery label uses the current thresholds. A score below Familiar remains New.

## Card Difficulty And Points

Every generated card has a difficulty:

- Introductory: direct, supported use
- Standard: independent routine use
- Advanced: multi-step work or unfamiliar transfer
- Expert: ambiguous, synthesis-heavy, or unusually demanding work

An evaluated answer is cleared when it reaches the configurable passing score. The default passing score is `80`.

A cleared card adds a fixed number of mastery points based on card type and difficulty. A failed card adds no mastery points. The default values are:

| Card type | Introductory | Standard | Advanced | Expert |
| --- | ---: | ---: | ---: | ---: |
| Feynman | 8 | 12 | 16 | 20 |
| Relationship | 8 | 12 | 16 | 20 |
| Contrast | 8 | 12 | 16 | 20 |
| Debugging | 10 | 14 | 18 | 22 |
| Diagnostic | 8 | 12 | 16 | 20 |
| Drill | 6 | 10 | 14 | 18 |
| Quiz | 8 | 12 | 18 | 24 |
| Simulation | 10 | 14 | 20 | 26 |

The pass score, level thresholds, and complete points table are editable in Settings and can be reset to defaults. These are product calibration values, not claims of psychometric precision.

## Card Selection

There is no fixed number of cards per concept, stage, or type. The model chooses a useful mix and should avoid redundant cards already present in the deck.

Selection priorities are:

1. Work on active weaknesses that block the target proficiency.
2. Fill important gaps in concept-stage evidence.
3. Match the interaction to the nature of the concept.
4. Use the learner profile to set expected depth and context.
5. Follow the note's generation prompt.

The model must not create passive concept review, metaphor recall, memory-scene reconstruction, or generic definition cards as invented categories.

## Card Contracts

### Feynman

Purpose: make the learner teach one concept plainly enough to expose weak understanding.

Before answering:

1. Show exactly one concept card.
2. Show that concept's role and image from the shared metaphor.
3. Ask: **Teach this concept in your own words. Do not copy the concept card's wording.**

After answering:

- identify the important weakness, if one exists
- give feedback in plain language
- show a detailed sample explanation

This is not a comparison question, mechanism checklist, or disguised quiz. Do not generate a Feynman card when the note has no shared metaphor.

### Relationship

Purpose: reason about why concepts are connected and what follows from the connection.

- Show a focused set of actual knowledge-graph relationships.
- Ask one question about those visible relationships.
- Do not merely list concept names or claim that a graph was supplied when the learner cannot see it.
- Do not reveal all target concept explanations before the answer.

### Contrast

Purpose: separate concepts the learner may confuse.

- Focus on one consequential distinction.
- Ask for the boundary, different prediction, or decision that follows from it.
- Use multiple concepts only when the distinction genuinely requires them.

### Debugging

Purpose: diagnose and repair a faulty mental model or artifact.

- Provide a concrete flawed claim, proof, trace, design, code fragment, or incident.
- Ask the learner to locate the failure and repair it.
- Do not reveal the target concept explanation before the answer.

### Diagnostic

Purpose: expose a precise gap through unsupported explanation.

- Hide the concept and metaphor before answering.
- Ask for one focused explanation from memory.
- Do not provide a multi-part answer checklist.
- Evaluate where the explanation becomes vague, term-heavy, or mechanically wrong.

### Drill

Purpose: build reliable procedural or reasoning skill.

- Give one focused exercise.
- Support mathematics, proofs, algorithms, coding patterns, and other procedural subjects.
- Require intermediate work when it helps locate the exact mistake.
- Reveal a worked solution and targeted feedback after evaluation.

### Quiz

Purpose: test independent reasoning on one coherent problem.

- Prefer difficult, answerable tasks over easy conceptual checks.
- Test transfer, edge cases, tradeoffs, or synthesis when the concept supports them.
- Never bundle unrelated questions into one card.

### Simulation

Purpose: apply concepts in a bounded work or project environment.

- State the learner's role, constraints, and starting state.
- Continue as a multi-turn interaction.
- Keep the simulated environment consistent.
- End when there is enough evidence to evaluate or the learner explicitly ends it.

## Answer Experience

Cards support a single answer or a bounded multi-turn interaction. The answer field grows with its content. Answer actions stay at the lower right of the answer area.

After evaluation, show:

- score and personalized feedback
- detailed sample answer or worked solution
- weaknesses exposed or resolved
- the resulting card state
- an option to peek at relevant concept cards when they were hidden before answering

Peeking is available only after answer reveal and does not change the score.

All card prompts, sample answers, feedback, tables, diagrams, code, and chat messages use the shared rich Markdown presentation.

## Card Outcomes

### Cleared

When the answer reaches the configured pass score:

- mark the card done
- add its configured points to every targeted concept-stage pair
- cap each stage score at `100`
- resolve a targeted weakness only when the evaluator confirms that the answer no longer shows it

### Not Cleared

When the answer is below the configured pass score:

- award zero mastery points
- keep the card associated with its targets
- record material weaknesses
- delay the card for three days in the current slice

Long-term forgetting-curve scheduling remains deferred.

## Weakness Lifecycle

A weakness is either:

- Active: available to influence future generation
- Resolved: retained in history but excluded from weakness-focused generation

A card intentionally generated to address a weakness is associated with it. After evaluation:

- a passing answer may resolve it only when the evaluator directly confirms the gap is absent
- a failed answer keeps it active
- several weaknesses on one card are evaluated independently
- later contradictory evidence reopens the existing weakness instead of creating a duplicate

Future generation should converge on current weaknesses and stop focusing on weaknesses already solved.

## Associations And Deletion

A card may belong to one or many concepts and may record one or many stages for each concept.

Deleting a concept removes its card targets, weakness targets, attempts, and related progress. A shared card remains when it still has another surviving concept target. A card with no surviving targets is deleted.

Deleting all generated concepts for a note cascades through cards, attempts, weaknesses, progress, metaphor data, and generated mastery images.

## Mastery Area

The Mastery header contains the Concepts/Flashcards switch next to the title and current count.

The Concepts area owns its own Overview/Focus switch. The Flashcards area separately owns Deck/Practice views. This keeps navigation scoped to the content it changes.

## Deferred Scheduling

The current slice stores review timestamps and uses the initial three-day failed-card delay, but it does not yet implement:

- forgetting-curve scheduling
- automatic review planning
- a review calendar
- personalized scheduling parameters
- automatic generation when a concept-stage pair becomes due

Those behaviors should be designed after the card interactions and scoring values have been tested in real use.

## Acceptance Criteria

1. Each note retains a target proficiency and generation prompt.
2. Generating again adds cards and avoids repeating existing cards.
3. Card type is selected independently from mastery stage.
4. Every card records only the concept-stage pairs its answer genuinely demonstrates.
5. Feynman cards show exactly one concept and its metaphor, then ask the learner to teach it in their own words.
6. Relationship cards show the exact graph relationships used by the question.
7. Contrast, debugging, diagnostic, drill, quiz, and simulation cards follow their defined interaction contracts.
8. Mathematical and procedural concepts can receive focused drills and hard problems.
9. Answer fields grow with their content and actions are aligned at the lower right.
10. Evaluation reveals feedback, a detailed sample answer, and weakness outcomes.
11. Hidden concept cards can be peeked only after answer reveal; peeking does not affect score.
12. A failed answer adds no mastery points and delays the card for three days.
13. A cleared answer adds the configured card-type-and-difficulty points to every target pair without dividing credit.
14. The pass score, mastery thresholds, and points matrix are editable and independently resettable.
15. Resolved weaknesses stop influencing generation and can be reopened by later evidence.
16. Deleting concepts and cards cascades without deleting a shared card that still has a surviving target.
