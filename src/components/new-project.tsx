"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewProject() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, brief }),
    });

    setBusy(false);
    if (!response.ok) {
      setError(await response.text());
      return;
    }

    const { project } = await response.json();
    router.push(`/p/${project.slug}`);
  }

  return (
    <form onSubmit={create} className="flex max-w-xl flex-col gap-3 border-t border-rule pt-6">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink-faint">New project</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What are you learning?"
        className="border border-rule bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Brief (optional) — what you already know, and how you want things explained. Every turn sees this."
        rows={3}
        className="border border-rule bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-signal">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="w-fit border border-accent px-4 py-1.5 text-sm text-accent disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
