# Subject Materials

Learner treats each document folder as a subject. Subject materials are reusable inputs for generated notes and cheat sheets; they do not replace the editable notes in the folder.

## Storage

Source metadata and extracted text are stored in the `subject_sources` table in `learner.sqlite`. Imported file originals are copied into the application's `subject-sources` data directory so generation does not depend on the original file remaining in place. Article URLs store the final public URL and extracted text. Existing Learner notes store a document-path reference and are read live for each generation.

Moving or deleting a folder updates or removes its source records. Moving, renaming, or deleting a referenced note updates or removes that reference as part of the existing document IPC operation.

## Trust Boundary

Parsing, URL retrieval, source persistence, and generation run in Electron's main process behind the preload bridge. URL imports accept only HTTP and HTTPS, reject credentials and private or local destinations, validate redirects, and enforce time and response-size limits.

Source content is treated as untrusted evidence in AI prompts. Generated citations are validated against selected source IDs. When outside research is enabled, citations without a supplied source ID must use a URL returned by the web-research pass.

## Generation

Note and cheat-sheet generation use the shared LangChain client in `electron/aiClient.js` and strict Zod output schemas. Outside research is a separate, explicit pass and is never performed when the workspace toggle is off.

Cheat-sheet sheet count and duplex settings determine the exact requested number of sides. Layout settings are included in the generation restrictions, while the renderer applies the same paper dimensions and typography to its print preview. The preview reports browser-layout overflow because word budgets cannot perfectly predict tables, formulas, code, or diagrams.
