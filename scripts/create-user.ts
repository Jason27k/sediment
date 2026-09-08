import { createInterface, type Interface } from "node:readline/promises";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { auth, authOptions } from "../src/lib/auth-config";

/**
 * Creates an account, or sets a password on one that already exists.
 *
 * Sign-up is disabled on the shipped auth instance (§15 — single user, no
 * onboarding), so the create path rebuilds the same config with it switched
 * back on rather than reimplementing password hashing.
 *
 * The adopt path matters once: the DEV_USER_EMAIL stub created a users row with
 * no credential behind it, and that row owns the existing projects and notes.
 * Signing up fresh would collide on the unique email and strand the corpus, so
 * an existing user gets a password attached to the id it already has. This is
 * the same link-or-update the library's own reset-password route performs.
 *
 * Every prompt can be pre-answered with an environment variable, which is what
 * makes this usable for seeding a deployment as well as by hand:
 *   CREATE_USER_EMAIL, CREATE_USER_PASSWORD, CREATE_USER_NAME, CREATE_USER_FORCE
 */
async function ask(rl: Interface, prompt: string, preset: string | undefined): Promise<string> {
  if (preset !== undefined) return preset.trim();
  const answer = await rl.question(prompt);
  return (answer ?? "").trim();
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const email = await ask(rl, "Email: ", process.env.CREATE_USER_EMAIL);
    const password = await ask(rl, "Password (min 8 chars): ", process.env.CREATE_USER_PASSWORD);

    if (!email || !password) throw new Error("Email and password are required.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    const ctx = await auth.$context;
    const existing = await ctx.internalAdapter.findUserByEmail(email);

    if (existing) {
      const confirm = await ask(
        rl,
        `${email} already exists. Set its password? [y/N] `,
        process.env.CREATE_USER_FORCE,
      );
      if (confirm.toLowerCase() !== "y") {
        console.log("\nNothing changed.");
        return;
      }

      const userId = existing.user.id;
      const hashed = await ctx.password.hash(password);

      if (await ctx.internalAdapter.findCredentialAccount(userId)) {
        await ctx.internalAdapter.updatePassword(userId, hashed);
      } else {
        await ctx.internalAdapter.linkAccount({
          userId,
          providerId: "credential",
          accountId: userId,
          password: hashed,
        });
      }

      if (!existing.user.name) {
        await ctx.internalAdapter.updateUser(userId, { name: email.split("@")[0] });
      }

      console.log(`\nPassword set for ${email} (${userId}).`);
      return;
    }

    const name =
      (await ask(rl, "Name: ", process.env.CREATE_USER_NAME)) || email.split("@")[0];

    const signUpAuth = betterAuth({
      ...authOptions,
      emailAndPassword: { ...authOptions.emailAndPassword, disableSignUp: false },
    });

    try {
      const { user } = await signUpAuth.api.signUpEmail({ body: { email, name, password } });
      console.log(`\nCreated ${user.email} (${user.id}).`);
    } catch (error) {
      if (error instanceof APIError) throw new Error(error.message);
      throw error;
    }
  } finally {
    rl.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${(error as Error).message}`);
    process.exit(1);
  });
