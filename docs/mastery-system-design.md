# Mastery Flashcard System Product Design

- Status: draft
- Scope: product design only
- Current slice: flashcards associated with mastery concepts
- Out of scope for this slice: full forgetting-curve scheduler, calendar, and long-term review optimization

## Product Intent

Build a flashcard system that behaves more like an adaptive drill system than a normal question-answer deck.

The system starts from detailed mastery concepts extracted from a note. Cards are generated around those concepts, but cards do not have to belong to only one concept or one learning stage. A contrast card can target two concepts. A project scenario can target several concepts. A debugging card can target one stage for one concept and another stage for a related concept.

The goal is not to maximize card count. The goal is to generate the next useful practice item based on:

- the concept's current mastery
- the user's weaknesses
- the stage being trained
- the user's background and target level
- optional instructions from the user
- the shape of the concept itself

## User Profile

The settings page should let the user describe their current background and target level.

Examples:

- "I am doing a PhD in machine learning."
- "I am a senior software engineer."
- "I want questions at research depth."
- "I want software architecture and production tradeoff questions."
- "I am new to distributed systems."

The card generator and answer evaluator should use this profile to calibrate difficulty.

For an advanced user, avoid basic definitional prompts unless the concept is genuinely new or the user has repeatedly failed basic comprehension. Prefer questions that test mechanisms, assumptions, tradeoffs, counterexamples, implementation consequences, and transfer to unfamiliar situations.

## Concept Tracking

Each mastery concept should track:

- mastery level
- stage points for each learning stage
- generated cards linked to the concept
- weaknesses exposed by answers
- last reviewed time
- latest answer quality
- whether the concept is active, done, or archived

The current stage numbers are:

1. Acquisition
2. Comprehension
3. Advanced connection
4. Structuring and modeling
5. Debugging
6. Application

Stage 1 is handled by reading the note. The flashcard system starts at Stage 2.

Each concept should have numeric stage progress:

- Stage 2 comprehension points: 0-100
- Stage 3 connection points: 0-100
- Stage 4 structure points: 0-100
- Stage 5 debugging points: 0-100
- Stage 6 application points: 0-100

The existing mastery level can remain the compact label shown in the UI, but card generation should use the stage points and weakness history. A concept should not be treated as high mastery just because the user can repeat a definition.

## Card Model

A flashcard is a reusable practice object.

Each card should track:

- prompt
- expected answer or answer rubric
- target concepts
- target stages
- difficulty
- required context
- whether concept cards are visible before answering
- whether metaphor context is visible before answering
- allowed answer mode
- attempts
- weaknesses exposed
- card status
- next eligible time

Cards can target:

- one concept in one stage
- one concept across multiple stages
- multiple concepts in one stage
- multiple concepts across multiple stages

Example:

- A contrast card about TCP vs UDP can target Stage 4 for both concepts.
- A debugging card about duplicate message handling can target Stage 5 for idempotency and delivery semantics.
- A project simulation can target Stage 6 for several concepts from the same note.

## Card Status

Cards should have simple status before the full scheduling system exists:

- `active`: available now
- `in_progress`: currently being answered
- `cleared`: answered well enough and does not need to appear again by default
- `delayed`: answered weakly and should come back later
- `archived`: no longer relevant because concepts changed

For the first slice:

- If the user clears a card well, mark it as cleared.
- If the user answers poorly or partially, record weaknesses and delay it for about 3 days.
- If the user explicitly wants more practice, the system can generate new related cards instead of resurrecting cleared cards.

The full forgetting-curve scheduler comes later. For now, the app only needs enough card state to avoid losing practice history.

## Weakness Tracking

When the user fails or gives a weak answer, record the weakness as a first-class learning object.

Each weakness should track:

- related concepts
- related stages
- evidence from the user's answer
- severity
- short diagnosis
- recommended next card direction
- whether the weakness appears resolved later

Weakness examples:

- Cannot explain the mechanism.
- Confuses two related concepts.
- Knows the term but not the consequence.
- Misses an edge case.
- Gives a correct answer only in the original note context.
- Cannot transfer the idea to a new scenario.
- Cannot debug a broken example.

Future card generation should use weaknesses directly. If the user fails because they confuse delivery reliability with ordering, later cards should ask contrast, debugging, and scenario questions around that confusion.

## Shared Answer Experience

Every card should support a shared answer flow:

1. Show the prompt.
2. Optionally show concept card context before answering.
3. Let the user answer.
4. Let the user reveal the answer or ask for evaluation.
5. Grade the answer with an LLM.
6. Show feedback.
7. Record exposed weaknesses.
8. Update stage points and card status.
9. Offer a concept card peek after answer reveal.

Answer modes:

- single-turn answer
- multi-turn drill chat
- project simulation chat
- quiz answer

The user should be able to end a multi-turn session explicitly. The LLM can also decide that the drill has reached a natural stopping point and recommend ending.

## Shared Renderer

Cards, chat feedback, revealed answers, graph questions, tables, and generated diagrams should share one renderer.

The renderer should support:

- Markdown
- GitHub-style tables
- code blocks
- Mermaid diagrams
- images
- concept card embeds
- metaphor image embeds

Stage 4 especially needs tables and Mermaid diagrams because relationship and structure questions may naturally use matrices, flows, or dependency graphs.

## Stage 2: Comprehension

Goal:

- Make sure the user can explain the concept in plain language and understands the mechanism.

Default card type:

- Feynman explanation drill

Prompt shape:

- Show the concept card.
- Ask the user to explain the concept as if teaching it to someone intelligent but unfamiliar with the note.
- Ask for mechanism, example, and why it matters.

Answer modes:

- single-turn answer
- multi-turn drill chat

Multi-turn behavior:

- The LLM asks follow-up questions when the explanation is vague, term-heavy, or missing mechanism.
- The drill ends when the user gives a clear explanation or explicitly asks to stop.
- The system records weaknesses from the conversation, not only from the first answer.

Concept visibility:

- Concept card is visible before answering.
- After answer reveal, the user can peek at the concept card again.

Generation guidance:

- Low mastery should prioritize these cards.
- Do not generate many redundant definition cards.
- If the concept is simple but application is hard, generate fewer Stage 2 cards and move practice toward later stages.

## Stage 3: Advanced Connection

Goal:

- Connect the concept to a vivid metaphor, memory image, and nearby ideas.

Default card types:

- metaphor recall card
- concept-to-metaphor explanation card
- memory scene reconstruction card

Prompt shape:

- Show the concept card.
- Show the shared metaphor and image when available.
- Ask the user to explain what the concept is inside the metaphor and why that mapping works.

Concept visibility:

- Concept card is visible.
- Metaphor is visible.
- Image is visible if generated.

Generation guidance:

- Use the current metaphor world if one exists.
- If the metaphor is stale, suggest regenerating it before generating many Stage 3 cards.
- Stage 3 is useful for low-to-mid mastery, especially when the user can understand the concept but does not remember it easily.

## Stage 4: Structuring And Modeling

Goal:

- Make the user understand relationships, contrasts, dependencies, and external connections.

Default card types:

- contrast card
- relationship explanation card
- concept map question
- graph-based question
- matrix/table card
- Mermaid flow card

Inputs:

- mastery concepts
- knowledge graph concepts
- knowledge graph relationships
- source note
- optionally related external concepts

Prompt shape:

- Ask questions about relationships between concepts.
- Ask the user to compare two or more concepts.
- Ask the user to explain why a relation exists.
- Ask the user to complete or critique a table, flow, or diagram.

Answer rendering:

- Markdown tables are allowed.
- Mermaid diagrams are allowed.
- The shared renderer must be used.

Generation guidance:

- Mid mastery should receive more Stage 4 cards.
- A card can target multiple concepts.
- If the graph is missing, the system can still generate relationship cards from mastery concepts, but graph-backed cards should be preferred when graph data exists.

## Stage 5: Debugging

Goal:

- Expose broken mental models, missing edge cases, and false confidence.

Default card types:

- boundary-condition test
- broken-example diagnosis
- Feynman diagnostic without visible concept card
- misleading scenario
- counterexample prompt

Prompt shape:

- Do not show the concept card before answering.
- Ask the user to reason through a case where the concept is easy to misuse.
- Include enough information to answer, but do not reveal the relevant concept card upfront.

Answer behavior:

- After the user answers, evaluate both correctness and reasoning.
- Reveal the concept card only after answer reveal or if the user chooses to peek.
- Record precise weaknesses.

Generation guidance:

- Mid-high mastery should receive more Stage 5 cards.
- These cards should be difficult enough to catch shallow understanding.
- If the user repeatedly fails Stage 5, future cards should generate simpler diagnostic steps before returning to harder cases.

## Stage 6: Application

Goal:

- Make the user apply the concept in realistic or hard scenarios.

Default card types:

- project scenario
- work simulation
- research-style application question
- architecture tradeoff prompt
- hard quiz

Prompt shape:

- Give a pseudo scenario.
- Ask the user to make decisions, justify tradeoffs, debug constraints, or design an approach.
- For a senior software engineering or PhD ML profile, scenarios should be at that level unless the concept itself is new.

Project simulation behavior:

- Use a multi-turn chat.
- The LLM plays the environment, teammate, reviewer, system, or user depending on the scenario.
- The user must ask questions, make choices, and respond to changing constraints.
- The session ends when the objective is solved, the LLM decides enough evidence has been collected, or the user asks to end.

Hard quiz behavior:

- Quizzes at this stage should not be easy conceptual checks.
- Prefer questions requiring transfer, tradeoffs, edge cases, derivation, implementation consequences, or synthesis across concepts.
- Multiple choice is acceptable only when distractors test real misconceptions.

Generation guidance:

- High mastery should receive more Stage 6 cards.
- A straightforward concept with difficult application should move here earlier.
- A concept that is conceptually complex but rarely applied may need more Stage 2-4 cards first.

## Card Generation Algorithm

When the user requests card generation, the system should ask for optional instructions.

Examples:

- "Generate more application cards."
- "Focus on graph relationships."
- "I want hard quiz questions."
- "I keep confusing X and Y."
- "Make this practical for backend system design."

Inputs to generation:

- selected concepts
- concept explanations
- concept mastery levels
- stage points
- existing cards
- card attempt history
- weaknesses
- metaphor data
- knowledge graph data
- user profile
- optional user instruction

The generator should decide how many cards to create. Do not hard-limit stage counts. The model should justify card mix through the generated card metadata, not through UI explanation.

Rough selection rule:

- Low mastery: focus on Stage 2 comprehension and Stage 3 connection.
- Mid mastery: focus on Stage 4 relationships, contrasts, and structure.
- Mid-high mastery: focus on Stage 5 debugging and Stage 6 application.
- High mastery: generate fewer but harder Stage 6 cards, especially scenario and synthesis cards.

Override rule:

- The concept itself matters more than the rough rule.
- A simple definition with hard real-world use should receive application cards earlier.
- A concept with many confusable neighbors should receive contrast and relationship cards earlier.
- A concept with repeated reasoning errors should receive debugging cards even if the mastery label is not high.

## Card Evaluation

The evaluator should produce:

- score
- pass/fail
- confidence
- feedback
- ideal answer or rubric comparison
- weaknesses exposed
- stage point updates
- card status recommendation

The score should not be based only on whether the final answer sounds correct. It should consider:

- mechanism
- causal reasoning
- examples
- edge cases
- transfer
- relationship to other concepts
- ability to debug misuse
- ability to apply under constraints

For most cards:

- Strong answer: mark cleared and raise relevant stage points.
- Partially correct answer: record weaknesses and delay the card.
- Weak answer: record weaknesses, delay the card, and generate follow-up cards if useful.

## Concept Peek

When answering a card, the user should be able to reveal support context.

Peek options:

- show concept card
- show source excerpt
- show metaphor
- show graph neighbors

Peeking before answering should reduce the evaluation strength because the user used support. Peeking after answer reveal should not penalize the answer.

Stage behavior:

- Stage 2 and Stage 3 can show concept support before answering.
- Stage 4 can show selected graph or relationship context when the card is designed for inspection.
- Stage 5 should hide the concept card before answering by default.
- Stage 6 should usually hide concept cards before answering, but allow peeking if the user wants guided practice.

## First Build Slice

The first flashcard implementation should include:

- user profile fields in settings
- generate cards from current mastery concepts
- optional generation instruction
- card list grouped by concept and stage
- card detail view
- single-turn answer mode
- multi-turn Feynman drill mode
- answer reveal
- LLM grading
- weakness recording
- per-stage points
- card status: active, cleared, delayed, archived
- concept peek after answer reveal
- shared Markdown renderer for card prompts, answers, and feedback

Stage 4-6 cards can be generated early, but the first slice should not need the full scheduling/calendar system.

## Product Acceptance Criteria For First Slice

1. A user can generate flashcards from extracted mastery concepts.
2. The generator can use optional user instructions.
3. Each generated card shows its target concepts and stage numbers.
4. A card can target multiple concepts and multiple stages.
5. The user can answer a card in single-turn mode.
6. The user can do a multi-turn Feynman drill for comprehension cards.
7. The evaluator records score, feedback, card status, and weaknesses.
8. Weaknesses appear on the associated concepts.
9. Cleared cards do not reappear by default.
10. Weak cards are delayed instead of deleted.
11. The user can peek at the concept card after revealing the answer.
12. The renderer supports Markdown tables and Mermaid diagrams for relationship cards.
