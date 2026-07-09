# Mastery System Product Concept

Status: draft  
Scope: structured product concept only  
Intent: organize the original feature idea before deriving requirements and acceptance criteria

## Core Idea

Build a flashcard system that is not a typical flashcard system.

The system should first extract detailed concepts from notes. These concepts should be more detailed than the current knowledge graph concepts, because they are used for learning and mastery rather than just graph structure.

For each extracted concept, the app should track mastery level and generate a deck of cards aimed at different learning goals.

The learning model is based on Scott Young's holistic learning stages:

1. Acquisition
2. Comprehension
3. Advanced Connection
4. Structuring and Modeling
5. Debugging
6. Application

The mastery system starts after acquisition. Acquisition is handled by reading the raw notes.

## Product Shape

The app should have a `Mastery` entry point.

Inside mastery, the interface should have tabs such as:

- `Graph`
- `Flash Cards`
- `Concepts`

The existing graph interface can move into the `Graph` tab.

The system should track mastery progress after generating mastery content.

The system should also have a calendar view to show what needs review and when.

## Concepts

Mastery concepts are not the same as knowledge graph concepts.

Knowledge graph concepts:

- are useful for graph structure
- can be broader and more reusable
- help show relationships between notes and ideas

Mastery concepts:

- should be more detailed
- should be specific enough to practice
- should support multiple card types
- should be the parent object for one-to-many flashcards later
- should track mastery progress
- should track weaknesses and strengths based on user answers

The app should not rely only on knowledge graph concepts for flashcards. It should extract more detailed learning concepts.

For the first slice, ignore flashcards and build only:

- detailed mastery concepts
- mastery level per concept
- source-grounded summaries and explanations

## Mastery Tracking

Each concept should track mastery level.

The default target should be `proficient`. The user does not need to master everything perfectly by default.

The user should also be able to manually choose `done`.

Mastery should change based on the user's card answers:

- correct answers increase mastery
- weak answers expose weaknesses
- repeated weaknesses should affect future cards
- difficulty should adapt based on mastery level and weaknesses

## Mastery Level Algorithm

Mastery levels:

1. `new`
2. `familiar`
3. `developing`
4. `proficient`
5. `advanced`
6. `mastered`

Default target:

- `proficient`

Generation-time rule:

- New concepts should usually start as `new` or `familiar`.
- Existing concepts should keep their prior level unless the regenerated concept is meaningfully different.
- The model can choose the level during regeneration, but it should consider:
  - previous mastery level
  - whether the concept still maps to the same idea
  - whether the source note changed the concept meaning
  - existing strengths and weaknesses

Future answer-based rule:

- A card only counts as passed when the answer is at least 80% correct.
- Repeated correct answers raise mastery.
- Repeated weak answers lower confidence and keep the concept in review.
- Debugging and application cards should matter more for higher mastery than basic comprehension cards.

Proposed score-to-level mapping for later:

- `new`: 0-19
- `familiar`: 20-39
- `developing`: 40-69
- `proficient`: 70-84
- `advanced`: 85-94
- `mastered`: 95-100

Proposed stage weighting for later:

- comprehension: 35%
- advanced connection: 10%
- structuring and modeling: 20%
- debugging: 15%
- application: 20%

This means a user can become `developing` mostly through comprehension, but should not become `proficient` without at least some structuring, debugging, or application success.

## Regeneration Algorithm

When regenerating concepts for a note:

1. Send the existing concepts into the prompt.
2. Include each existing concept's name, summary, mastery level, and known strengths or weaknesses.
3. Ask the model to decide whether each concept should:
   - stay
   - update
   - merge into a better concept
   - disappear because it no longer fits the note
4. Ask the model to assign a mastery level for each returned concept.
5. Preserve continuing concepts when possible.
6. Create new concepts when the note contains new learnable ideas.
7. Archive concepts that no longer fit instead of treating them as actively reviewable.

Identity matching rule:

- Prefer an explicit existing concept match.
- If there is no explicit match, match by normalized concept name.
- If neither matches, create a new concept.

Mastery preservation rule:

- If a concept keeps the same identity, preserve its learning history.
- If a concept is renamed but still means the same thing, preserve its learning history.
- If a concept is split, the old concept can be archived and new concepts can start at lower mastery.
- If concepts are merged, the merged concept should keep the strongest relevant history but still track unresolved weaknesses.

Regeneration prompt rule:

- If the document hash changed after the last generation, show a subtle prompt suggesting regeneration.
- Do not automatically regenerate over existing concepts without user action.

## Stage 1: Acquisition

Goal:

- Input information cleanly, quickly, and with minimal clutter.

Methods:

- Pointer Method
- Information Laundering

Product decision:

- No special flashcard workflow is needed here.
- Users handle acquisition by reading the raw notes.
- The mastery system begins after acquisition.

## Stage 2: Comprehension

Goal:

- Understand the surface-level meaning and mechanics of the concept.

Main method:

- Feynman-style self explanation.

Product behavior:

1. Show a concept card or prompt.
2. Ask the user to explain the concept using the Feynman technique.
3. Show tips for how to answer with the Feynman technique.
4. Let the user answer through:
   - chatbox
   - image attachment
   - speech-to-text
5. Use an LLM to grade the answer.
6. Reveal the standard answer.
7. Reveal personalized feedback based on the user's answer.
8. Increase mastery level if the answer is good enough.

Card discard rule:

- Only discard or graduate a card when the user's answer is at least 80% correct.

## Stage 3: Advanced Connection

Goal:

- Tie the concept to other ideas, familiar memories, metaphors, and vivid mental images.

Methods:

- Metaphor Construction
- Visceralization

Product behavior:

1. Show a concept card.
2. Show the explanation for the concept.
3. Generate a metaphor for the concept.
4. Generate or show images for the metaphor.
5. Connect the concept with other related ideas.

The metaphor system can span many concepts, so multiple concepts can fit into one larger memorable metaphor world or visual system.

These cards do not always require the user to answer. They are mainly for concept recall and memory anchoring.

Concept cards should have a special entrance for revision. They can also appear inside the full flashcard deck.

Cards should use a reusable Markdown renderer. The chat renderer and card renderer should be the same or compatible.

## Stage 4: Structuring And Modeling

Goal:

- Compress information into simplified visual or structural models.

Methods:

- 2x2 Matrix Framework
- Flow-Based Note-Taking

Product behavior:

1. Use the detailed mastery concepts.
2. Also use the knowledge graph concepts.
3. Use the source notes.
4. Generate structure-focused study material, such as:
   - contrasts
   - matrices
   - tables
   - concept flows
   - questions based on concept flows
5. If knowledge graphs are not generated yet, generate them before preparing these flashcards.

The Markdown renderer needs table support so generated matrices and contrast tables are readable.

## Stage 5: Debugging

Goal:

- Look for flaws, gaps, contradictions, and broken mental models.

Methods:

- Boundary-Condition Test
- Feynman Diagnostic Drop

Product behavior:

- Generate relevant debugging questions for flashcards.
- Ask questions that expose whether the user's mental model breaks.
- Use answers to detect weaknesses.
- Use detected weaknesses to guide future cards.

## Stage 6: Application

Goal:

- Force knowledge out of theory and into practical use.

Methods:

- Project-Based Constraints
- Active Problem Set Testing

Product behavior:

1. Generate problems and fake scenarios where the concept must be applied.
2. Vary difficulty based on:
   - mastery level
   - weaknesses
   - strengths
3. Grade the user's answer.
4. Track weaknesses and advantages internally.
5. Generate future flashcards based on that performance.

## Answer Experience

Answering should be fast because manual practice can be time-consuming.

Answer input should support:

- text chatbox
- image attachment
- speech-to-text

After answering, the system should:

- grade with an LLM
- reveal the standard answer
- reveal personalized feedback
- update mastery level
- track weaknesses and strengths
- decide whether the card should continue appearing

## Concept Cards

Concept cards are for revision and memory anchoring.

They should show:

- concept explanation
- metaphor
- image
- related ideas

They can be:

- part of the full flashcard deck
- accessible from a special concept-card revision entrance

They do not always need user answers. Their main purpose is recall, connection, and memorability.

## Flashcard Decks

Each concept should have a deck of cards aimed at different things:

- comprehension
- advanced connection
- structuring and modeling
- debugging
- application

Cards should adapt over time based on answers.

The deck should not discard a card until the user reaches at least 80% correctness on that card.

## Review Scheduling

Once the mastery process starts, the app should use the forgetting curve to track what should be reviewed and when.

The system should schedule revision until:

- the user reaches the target mastery level, defaulting to `proficient`
- or the user manually chooses `done`

The calendar system should visualize review items.

## Mastery Progress

The system should track:

- mastery level per concept
- card progress
- weaknesses
- strengths
- review schedule
- target mastery

Progress should be visible from the mastery interface after content is generated.

## Content Rendering

Cards and chat should share a reusable Markdown rendering approach.

The renderer should support:

- normal Markdown explanations
- tables for matrices and contrasts
- images for metaphor and visceralization cards

## What To Derive Next

The next step is to derive requirements from this concept brief.

Likely requirement groups:

- concept extraction
- mastery tracking
- comprehension cards
- answer input
- grading and feedback
- concept cards
- structuring and modeling cards
- debugging cards
- application cards
- review scheduling
- calendar visualization
