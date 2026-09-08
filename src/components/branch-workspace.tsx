"use client";

import type { UIMessage } from "ai";
import { useCallback, useState } from "react";
import { AmendPanel } from "./amend-panel";
import { CaptureTray } from "./capture-tray";
import { ChatPane } from "./chat-pane";

export type BranchAnchorView =
  | { kind: "note"; noteId: string; noteSlug: string; noteTitle: string }
  | { kind: "message" }
  // A note branch whose note has been deleted. It has nothing left to amend,
  // and it must not grow a capture tray: extraction stays off server-side for
  // every note branch, so a tray here could only ever sit empty.
  | { kind: "detached" };

/**
 * A branch (§07). The chat is identical to the main thread; what differs is what
 * sits beside it.
 *
 * A note branch amends the note it hangs off, so it gets the amendment panel and
 * no capture tray — extraction is skipped server-side for exactly this case. A
 * message branch is an ordinary tangent and proposes new notes as normal.
 */
export function BranchWorkspace({
  projectSlug,
  conversationId,
  initialMessages,
  anchor,
}: {
  projectSlug: string;
  conversationId: string;
  initialMessages: UIMessage[];
  anchor: BranchAnchorView;
}) {
  const [trayKey, setTrayKey] = useState(0);
  const refreshTray = useCallback(() => setTrayKey((n) => n + 1), []);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <ChatPane
        projectSlug={projectSlug}
        conversationId={conversationId}
        initialMessages={initialMessages}
        onTurnComplete={anchor.kind === "message" ? refreshTray : undefined}
        placeholder={anchor.kind === "note" ? "What is not landing?" : "Ask something"}
        empty={
          <p className="text-sm text-ink-faint">
            {anchor.kind === "note"
              ? "Say what does not make sense about this note. The main thread stays where it was."
              : "Chase the tangent here. The main thread stays where it was."}
          </p>
        }
      />

      {anchor.kind === "note" && (
        <AmendPanel
          noteId={anchor.noteId}
          noteSlug={anchor.noteSlug}
          noteTitle={anchor.noteTitle}
          projectSlug={projectSlug}
          conversationId={conversationId}
        />
      )}

      {anchor.kind === "message" && (
        <CaptureTray projectSlug={projectSlug} refreshKey={trayKey} />
      )}

      {anchor.kind === "detached" && (
        <aside className="lg:border-l lg:border-rule lg:pl-6">
          <p className="text-xs leading-relaxed text-ink-faint">
            The note this branch amended is gone, so there is nothing left to fold into.
            The reasoning stays readable.
          </p>
        </aside>
      )}
    </div>
  );
}
