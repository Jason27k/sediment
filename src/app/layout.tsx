import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { signOut } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sediment",
  description: "A chat that leaves notes behind.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <header className="border-b border-rule">
          <div className="mx-auto flex max-w-6xl items-baseline gap-4 px-6 py-3">
            <Link href="/" className="font-mono text-sm tracking-wide text-accent">
              sediment
            </Link>
            <span className="font-mono text-xs text-ink-faint">
              chat in, notes out
            </span>
            {user ? (
              <div className="ml-auto flex items-baseline gap-3">
                <span className="font-mono text-xs text-ink-faint">{user.email}</span>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="font-mono text-xs text-ink-faint hover:text-accent"
                  >
                    sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
