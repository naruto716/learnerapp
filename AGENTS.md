<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project Engineering Rules

- Think through the product requirement before writing code. Do not add adjacent features, extra entry points, or broad workflows unless the user explicitly asks for them.
- Keep first slices small and reversible. Prefer a narrow working path over speculative product surface.
- Put feature orchestration in feature-owned controllers/hooks, not in `AppShell`. `AppShell` should compose top-level surfaces and hold only minimal cross-feature coordination state.
- For AI workflows, use the shared LangChain-based abstraction. Do not add direct model `fetch` calls for chat, structured output, or embeddings.
- For multi-step AI behavior, design the orchestration first. Do not run separate AI steps in parallel when later steps must share a coherent concept, metaphor, or plan.
- Preserve existing app patterns and boundaries. If a file is already large, avoid adding more unrelated state or callbacks to it.
- If requirements are ambiguous, implement the smallest clearly requested behavior and leave the rest unbuilt.
