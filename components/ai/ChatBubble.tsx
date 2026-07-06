import { SparkleIcon } from "@phosphor-icons/react";

export default function ChatBubble({
  isOpen,
  toggleBubbleOpen,
}: {
  isOpen?: boolean;
  toggleBubbleOpen?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={isOpen ? "Close AI chat" : "Open AI chat"}
      aria-pressed={isOpen}
      className="app-no-drag fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/80 backdrop-blur-lg transition-colors hover:bg-white/20"
      onClick={toggleBubbleOpen}
    >
      <SparkleIcon size={18} weight="fill" />
    </button>
  );
}
