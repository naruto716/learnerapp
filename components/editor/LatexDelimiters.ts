import { Extension, InputRule } from "@tiptap/core";

export const LatexDelimiters = Extension.create({
  name: "latexDelimiters",

  addInputRules() {
    const inlineMathType = this.editor.schema.nodes.inlineMath;
    const blockMathType = this.editor.schema.nodes.blockMath;

    return [
      new InputRule({
        find: /\\\((.+?)\\\)$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim();
          if (!latex || !inlineMathType) return null;

          state.tr.replaceWith(range.from, range.to, inlineMathType.create({ latex }));
        },
      }),
      new InputRule({
        find: /^\\\[([\s\S]+?)\\\]$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim();
          if (!latex || !blockMathType) return null;

          const { tr } = state;
          const $from = state.doc.resolve(range.from);
          const node = blockMathType.create({ latex });
          const consumesHostTextblock =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end();
          const canReplaceHostTextblock =
            consumesHostTextblock &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), blockMathType);
          const replacementRange = canReplaceHostTextblock
            ? { from: $from.before(), to: $from.after() }
            : range;

          tr.replaceWith(replacementRange.from, replacementRange.to, node);
        },
      }),
    ];
  },
});
