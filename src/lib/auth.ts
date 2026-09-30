/**
 * Fallback authentication (BRD 5.2), used because this build is not inside BEAM (DECISIONS.md).
 * Sign-in with Microsoft Entra ID or Google; no passwords. In mock mode only, a sign-in bypass
 * lets you continue as any seeded user (BRD 21).
 *
 * Kept behind this module so it can be swapped for BEAM single sign-on: the rest of the app
 * only calls auth(), signIn() and signOut() from here, through src/lib/context.ts.
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getDataMode } from "@/config/env";
import { APP_BASE_PATH } from "@/config/product";
import { findUserIdByEmail, resolveSignIn } from "./identity";

const TWELVE_HOURS = 12 * 60 * 60;
const secure = process.env.APP_URL?.startsWith("https://") ?? false;
const cookiePrefix = secure ? "__Secure-" : "";

/** Every auth cookie is scoped to APP_BASE_PATH; nothing is set on the root domain (BRD 3.2). */
function cookie(name: string, httpOnly = true) {
  return {
    name: `${cookiePrefix}dmi.${name}`,
    options: { httpOnly, sameSite: "lax" as const, path: APP_BASE_PATH, secure },
  };
}

export function isMockSignInEnabled(): boolean {
  return getDataMode() === "mock";
}

const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_MICROSOFT_CLIENT_ID && process.env.AUTH_MICROSOFT_CLIENT_SECRET) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_TENANT ?? "common"}/v2.0`,
    }),
  );
}

if (process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET) {
  providers.push(Google({ clientId: process.env.AUTH_GOOGLE_CLIENT_ID, clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET }));
}

if (isMockSignInEnabled()) {
  providers.push(
    Credentials({
      id: "mock",
      name: "Mock sign-in",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(credentials) {
        if (!isMockSignInEnabled()) return null;
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const result = await resolveSignIn({ email, amr: ["mock"] });
        return result.ok ? { id: result.userId, email } : null;
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  basePath: `${APP_BASE_PATH}/api/auth`,
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? (isMockSignInEnabled() ? "mock-mode-only-not-secret" : undefined),
  pages: { signIn: `${APP_BASE_PATH}/sign-in`, error: `${APP_BASE_PATH}/sign-in` },
  // Rolling JWT: re-issued at most every 15 minutes, expires after 12 hours without activity.
  session: { strategy: "jwt", maxAge: TWELVE_HOURS, updateAge: 15 * 60 },
  cookies: {
    sessionToken: cookie("session"),
    callbackUrl: cookie("callback-url"),
    csrfToken: cookie("csrf"),
    pkceCodeVerifier: cookie("pkce"),
    state: cookie("state"),
    nonce: cookie("nonce"),
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "mock") return true; // resolved in authorize()
      if (!user.email) return false;
      const amr = Array.isArray(profile?.amr) ? (profile.amr as string[]) : null;
      const result = await resolveSignIn({ email: user.email, name: user.name, amr });
      return result.ok;
    },
    async jwt({ token, user }) {
      if (user?.email) token.uid = (await findUserIdByEmail(user.email)) ?? undefined;
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
