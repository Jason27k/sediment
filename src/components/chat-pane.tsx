"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The chat itself, shared by the main thread and by branches (§07).
 *
 * The only difference between the two is which conversation the turn is written
 * to, and that is a single field on the request — everything downstream of it,
 * including which context gets assembled, is decided on the server from the
 * conversation's anchor.
 */
export function ChatPane({
  projectSlug,
  conversationId,
  initialMessages,
  empty,
  placeholder = "Ask something",
  onTurnComplete,
  actions,
}: {
  projectSlug: string;
  conversationId?: string;
  initialMessages: UIMessage[];
  empty: ReactNode;
  placeholder?: string;
  onTurnComplete?: () => void;
  actions?: (message: UIMessage) => ReactNode;
}) {
  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { projectSlug, conversationId },
    }),
    onFinish: onTurnComplete,
  });

  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  // Extraction finishes shortly after the stream does; one delayed re-check
  // catches candidates that were still being written when onFinish fired.
  useEffect(() => {
    if (status !== "ready" || !onTurnComplete) return;
    const timer = setTimeout(onTurnComplete, 2500);
    return () => clearTimeout(timer);
  }, [status, onTurnComplete]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-5">
        {messages.length === 0 && empty}

        {messages.map((message) => (
          <article key={message.id} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint">
                {message.role === "user" ? "you" : "sediment"}
              </span>
              {actions?.(message)}
            </div>
            <div className="prose-note max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {message.parts
                .filter((p) => p.type === "text")
                .map((p, i) => (
                  <span key={i}>{(p as { text: string }).text}</span>
                ))}
            </div>
          </article>
        ))}

        {busy && <p className="font-mono text-xs text-ink-faint">thinking…</p>}
      </div>

      <form onSubmit={submit} className="sticky bottom-4 flex gap-2 bg-paper pt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="flex-1 border border-rule bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="border border-accent px-4 text-sm text-accent disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
