import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PRODUCT_NAME } from "@/config/product";
import { getSessionUser } from "@/lib/session";
import { bricolage, instrumentSans, spaceMono } from "./fonts";
import "@/styles/globals.css";

// Every page reads the session and DATA_MODE at request time, never at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: `BEAM ${PRODUCT_NAME}`, template: `%s | BEAM ${PRODUCT_NAME}` },
  description: "Relationship intelligence for senior decision-makers.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F4F6FC",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en-US" className={`${bricolage.variable} ${instrumentSans.variable} ${spaceMono.variable}`}>
      <body>
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
