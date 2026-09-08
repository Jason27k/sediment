"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initial: SignInState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-xs uppercase tracking-wide text-ink-faint">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="border border-rule bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-xs uppercase tracking-wide text-ink-faint">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border border-rule bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      {state.error ? <p className="text-sm text-signal">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-paper disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
