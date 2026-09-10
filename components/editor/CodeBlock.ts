import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import CodeBlockView from "./CodeBlockView";

const lowlight = createLowlight(common);

export const LearnerCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({
  defaultLanguage: null,
  enableTabIndentation: true,
  lowlight,
});
// Code block node configuration shared by the editor and its custom node view.
