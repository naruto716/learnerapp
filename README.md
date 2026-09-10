# Learner

Learner is a desktop study application that turns subjects into structured notes, helps students build mastery through active practice, and connects related ideas in a knowledge web.

The learning experience is based on Scott Young's holistic learning method. Instead of treating a note as a static page, Learner guides the student from first exposure to practical transfer.

## Core Workflow

1. **Create a note** for a subject or import the material you want to study.
2. **Generate structured learning content** with the AI study tools.
3. **Explore the knowledge web** to see how concepts relate to one another and to concepts in other notes.
4. **Generate mastery practice** from the note's concepts, graph relationships, current weaknesses, and target proficiency.
5. **Answer and evaluate practice cards** to receive feedback, sample answers, and updated mastery evidence.

Practice is adaptive: generating more cards adds to the existing deck and focuses on gaps rather than simply repeating the same review.

## Subject Materials And Generated Notes

Folders act as subjects. Open a folder's context menu and choose **Study materials** to build a reusable source collection from:

- PDF and DOCX documents
- Text, Markdown, and HTML files
- Pasted lecture notes or transcripts
- Public article URLs
- Existing Learner notes

Select the materials to use, then generate a source-grounded study note. Generated output is saved as a normal editable Learner note in the subject folder and includes a source list. Imported files and extracted article text are stored locally; existing-note sources are read again when generation starts so later edits are included.

The **Outside sources** switch is off by default. When enabled, Learner supplements the selected materials with live OpenAI web research. Submitted article URLs remain supplied sources and are available regardless of this switch. Outside research requires the official OpenAI API endpoint because compatible providers may not support OpenAI's hosted web-search tool.

## Cheat Sheets

The subject workspace can also generate a printable cheat sheet from the selected materials. Restrictions include physical sheet count, single- or double-sided printing, Letter or A4 paper, orientation, font, font size, margins, columns, line spacing, and free-form professor instructions.

Learner generates one preview page for each allowed printable side and warns when rendered content overflows. Cheat sheets are saved as editable notes. Use **Print** to open the operating system print dialog or save the preview as a PDF; when duplex output is required, enable double-sided printing in that dialog.

## The Five Learning Stages

Learner organizes study around five stages. A subject may move through the stages repeatedly as the student discovers weaknesses or encounters more difficult applications.

### 1. Get

Build an initial map of the subject. The student gathers the key terms, facts, questions, and concepts needed to orient themselves. Notes and generated concept cards provide the starting material.

### 2. Understanding

Turn information into meaning. The student explains concepts in their own words, identifies how mechanisms work, and checks whether they can describe an idea without copying the note.

### 3. Expansion

Connect the new material to prior knowledge and broader mental models. Relationship cards and the knowledge web help the student reason about dependencies, causes, consequences, and useful analogies.

### 4. Error Correction

Find and repair inaccurate or incomplete mental models. Diagnostic, contrast, and debugging exercises expose confusion, missing steps, and concepts that are being used incorrectly.

### 5. Application

Transfer knowledge to unfamiliar situations. Drills, quizzes, and simulations ask the student to solve problems, make decisions, and use the concepts under realistic constraints.

Mastery evidence is collected across these stages. Passing an exercise increases evidence for the concepts and stages it genuinely demonstrates; failed attempts record weaknesses that can guide future practice.

## Knowledge Web

The knowledge web represents the learner's subjects as a graph:

- **Nodes** represent concepts extracted from notes.
- **Edges** represent meaningful relationships between concepts.
- **Cross-note links** connect related subjects, making prior knowledge easier to reuse.
- **Relationship practice** uses visible graph connections so students reason about why concepts are linked, not just memorize their names.

The web is useful for finding prerequisites, understanding how ideas influence one another, spotting gaps, and choosing a path through a larger subject. It complements the notes rather than replacing them: the note contains the explanation, while the graph shows how that explanation fits into the learner's wider knowledge.

## Practice And Mastery

Learner supports several practice formats, including:

- Feynman explanations
- Relationship reasoning
- Contrast questions
- Debugging and diagnostic tasks
- Procedural drills
- Quizzes
- Multi-turn simulations

Each card can target one or more concepts and record evidence for the stages demonstrated by the answer. Cards are evaluated with a configurable passing score, difficulty, and mastery-point system. Active weaknesses remain available to future generation until later evidence shows that the problem has been resolved.

For the detailed behavior and data rules, see [`docs/mastery-system-design.md`](docs/mastery-system-design.md).

## Running Locally

Install dependencies:

```bash
npm install
```

Run the web development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

Run the desktop development experience with Electron:

```bash
npm run electron:dev
```

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run electron:dev` | Run Next.js and the Electron desktop shell together |
| `npm run build` | Build the static application export |
| `npm run electron:preview` | Build and open the Electron application |
| `npm run electron:dist` | Build a distributable Electron package |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Electron unit tests, including source ingestion and cheat-sheet restrictions |
| `npm run test:mastery` | Run the mastery-card smoke test |

## Project Structure

```text
app/                  Next.js routes and global styles
components/           Editor, AI, mastery, graph, and application UI
electron/              Desktop process, local data, source ingestion, AI integration, and graph storage
docs/                 Product specifications and design documentation
scripts/              Smoke tests and local data utilities
```

Learner uses Next.js and React for the interface and Electron for the desktop runtime. AI operations use the shared LangChain-based client. Notes and graph data are managed locally by the Electron side of the application.

## Configuration Files

- `next.config.ts` enables static export for desktop packaging and disables Next image optimization.
- `eslint.config.mjs` extends the Next.js lint presets and relaxes the JavaScript-only Electron and script entrypoints.
- `postcss.config.mjs` connects Tailwind's PostCSS plugin for renderer utility classes.
- `.gitignore` excludes generated dependencies, build outputs, local environment files, and machine-specific artifacts.
- `package.json` defines application metadata, development/build commands, runtime dependencies, and Electron packaging settings.
- `tsconfig.json` defines the TypeScript compiler target, module resolution, path aliases, and included source files.
- `opencode.json` defines the repository-local OpenCode permissions and project tooling configuration.
