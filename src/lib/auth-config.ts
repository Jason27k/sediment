import { Pool } from "@neondatabase/serverless";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is not set. Copy .env.example to .env.local.");
}

/**
 * Better Auth needs a node-postgres-style pool, which the neon() tagged-template
 * driver in db.ts is not — it rejects the sql(text, params) calls the Kysely
 * adapter makes. Pool is the WebSocket path and is pg-compatible, so the two
 * drivers sit side by side against the same database.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Every model is mapped to snake_case to match the schema in 0001. */
const timestamps = { createdAt: "created_at", updatedAt: "updated_at" } as const;

export const authOptions = {
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  // Single-user product (§15): sign-up is closed on the public surface and
  // accounts are created with `npm run create-user`.
  emailAndPassword: { enabled: true, disableSignUp: true },

  // Points at the existing users table rather than creating a second one, which
  // is what keeps the uuid foreign keys in 0001 intact.
  user: {
    modelName: "users",
    fields: { emailVerified: "email_verified", ...timestamps },
  },
  session: {
    modelName: "session",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      ...timestamps,
    },
  },
  account: {
    modelName: "account",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      ...timestamps,
    },
  },
  verification: {
    modelName: "verification",
    fields: { expiresAt: "expires_at", ...timestamps },
  },

  advanced: { database: { generateId: "uuid" } },

  // Required for server actions: without it signInEmail cannot set its cookie.
  plugins: [nextCookies()],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);
