"use client";

import type { UIMessage } from "ai";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { BranchButton } from "./branch-button";
import { CaptureTray } from "./capture-tray";
import { ChatPane } from "./chat-pane";
import type { TrayCandidate } from "@/lib/types";

type MessageBranch = { id: string; title: string | null; turns: number };

export function Workspace({
  projectSlug,
  initialMessages,
  branches,
  candidates,
}: {
  projectSlug: string;
  initialMessages: UIMessage[];
  branches: Record<string, MessageBranch[]>;
  candidates: TrayCandidate[];
}) {
  const router = useRouter();
  // Extraction writes candidates on the server, so the server is what re-reads
  // them; the turn ending is only the signal to look again.
  const refresh = useCallback(() => router.refresh(), [router]);

  // Only a persisted message can be branched from: a turn that just streamed
  // carries the client's own id, not the row's. Reloading makes it branchable,
  // which is a smaller cost than threading real ids back through the stream.
  const persisted = useMemo(
    () => new Set(initialMessages.map((m) => m.id)),
    [initialMessages],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <ChatPane
        projectSlug={projectSlug}
        initialMessages={initialMessages}
        onTurnComplete={refresh}
        empty={
          <p className="text-sm text-ink-faint">
            Ask something. Notes are proposed as you go — nothing is saved to the corpus
            until you accept it.
          </p>
        }
        actions={(message) => {
          if (!persisted.has(message.id)) return null;
          const existing = branches[message.id] ?? [];

          return (
            <span className="flex flex-wrap items-baseline gap-2">
              <BranchButton messageId={message.id} />
              {existing.map((branch) => (
                <Link
                  key={branch.id}
                  href={`/p/${projectSlug}/b/${branch.id}`}
                  className="font-mono text-[0.65rem] text-accent hover:underline"
                >
                  {branch.title ?? "branch"} · {branch.turns}
                </Link>
              ))}
            </span>
          );
        }}
      />

      <CaptureTray candidates={candidates} />
    </div>
  );
}
