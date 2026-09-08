import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth-config";
import type { User } from "./types";

/**
 * Resolves the signed-in user.
 *
 * Two entry points because pages and route handlers need different failures: a
 * page should send you to the login screen, while a route handler answering a
 * fetch should say 401 rather than return a redirect the client cannot follow.
 */
export async function getSessionUser(): Promise<User | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const { id, email, name, image } = session.user;
  return { id, email, name: name ?? null, image: image ?? null };
}

/** For server components. Redirects to /login when there is no session. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}
