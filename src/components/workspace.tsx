"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";
import { CaptureTray } from "./capture-tray";

export function Workspace({
  projectSlug,
  initialMessages,
}: {
  projectSlug: string;
  initialMessages: UIMessage[];
}) {
  const [trayKey, setTrayKey] = useState(0);
  const refreshTray = useCallback(() => setTrayKey((n) => n + 1), []);

  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { projectSlug } }),
    onFinish: refreshTray,
  });

  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  // Extraction finishes shortly after the stream does; one delayed re-check
  // catches candidates that were still being written when onFinish fired.
  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(refreshTray, 2500);
    return () => clearTimeout(timer);
  }, [status, refreshTray]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-5">
          {messages.length === 0 && (
            <p className="text-sm text-ink-faint">
              Ask something. Notes are proposed as you go — nothing is saved to the corpus
              until you accept it.
            </p>
          )}
          {messages.map((message) => (
            <article key={message.id} className="flex flex-col gap-1">
              <span className="font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint">
                {message.role === "user" ? "you" : "sediment"}
              </span>
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
            placeholder="Ask something"
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

      <CaptureTray projectSlug={projectSlug} refreshKey={trayKey} />
    </div>
  );
}
