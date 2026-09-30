"use server";

/** Settings, Sources: feeds, health checks, runs, the Apollo key and newsletter uploads (BRD 16.2). */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { feeds } from "@/db/schema";
import { setWorkspaceSecret } from "@/domain/secrets";
import { NewsletterCsvError, parseNewsletterCsv } from "@/ingest/adapters/newsletter/adapter";
import { checkSourceHealth, runSource } from "@/ingest/run";
import type { HealthResult } from "@/ingest/types";
import { enqueue } from "@/jobs/enqueue";
import { ACTIVE_JOBS } from "@/jobs/definitions";
import { audit } from "@/lib/audit";
import { EncryptionConfigError } from "@/lib/crypto";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

async function requireSettings() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "settings.change")) redirect("/?notice=not_allowed");
  return ctx;
}

const SOURCES = "/settings/sources";

export async function checkHealthAction(feedId: string, _prev: HealthResult | null): Promise<HealthResult> {
  const ctx = await requireSettings();
  return checkSourceHealth(ctx.workspace.id, feedId);
}

export async function runNowAction(feedId: string): Promise<void> {
  const ctx = await requireSettings();
  const [feed] = await withWorkspace(ctx.workspace.id, (tx) => tx.select().from(feeds).where(eq(feeds.id, feedId)).limit(1));
  const job = ACTIVE_JOBS.find((j) => j.source === feed?.sourceType);
  if (!feed || !job) redirect(`${SOURCES}?notice=source_not_runnable`);
  try {
    await enqueue(job.name, { workspaceId: ctx.workspace.id, feedId });
  } catch {
    redirect(`${SOURCES}?notice=queue_unavailable`);
  }
  redirect(`${SOURCES}?notice=run_queued`);
}

export async function toggleFeedAction(feedId: string, enabled: boolean): Promise<void> {
  const ctx = await requireSettings();
  await withWorkspace(ctx.workspace.id, async (tx) => {
    await tx.update(feeds).set({ enabled }).where(eq(feeds.id, feedId));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: enabled ? "feed.enabled" : "feed.disabled", entityType: "feed", entityId: feedId });
  });
  redirect(`${SOURCES}?notice=${enabled ? "feed_enabled" : "feed_disabled"}`);
}

const feedSchema = z.object({
  source_type: z.enum(["press_wire", "google_alert"], { message: "Choose a wire or Google Alerts." }),
  name: z.string().trim().min(1, "Name the feed.").max(120),
  urls: z
    .string()
    .transform((v) => v.split(/\s+/).map((u) => u.trim()).filter(Boolean))
    .refine((urls) => urls.length > 0, "Add at least one feed address.")
    .refine((urls) => urls.every((u) => /^https:\/\/\S+$/.test(u)), "Every feed address must start with https://."),
  keywords: z.string().transform((v) => v.split(",").map((k) => k.trim()).filter(Boolean)),
  terms_url: z
    .string()
    .trim()
    .refine((v) => !v || /^https?:\/\/\S+$/.test(v), "Enter the terms page's full address.")
    .transform((v) => v || undefined),
});

export async function addFeedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSettings();
  const raw = Object.fromEntries(["source_type", "name", "urls", "keywords", "terms_url"].map((k) => [k, String(formData.get(k) ?? "")]));
  const parsed = feedSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { message: `Check ${Object.keys(fieldErrors).length === 1 ? "this field" : "these fields"}: ${Object.keys(fieldErrors).join(", ").replace(/_/g, " ")}.`, fieldErrors, values: raw };
  }
  if (parsed.data.source_type === "press_wire" && !parsed.data.terms_url) {
    return { message: "Check this field: terms url.", fieldErrors: { terms_url: "Wire feeds need the link to their terms, so storage stays within them." }, values: raw };
  }
  await withWorkspace(ctx.workspace.id, async (tx) => {
    const [feed] = await tx
      .insert(feeds)
      .values({ workspaceId: ctx.workspace.id, sourceType: parsed.data.source_type, name: parsed.data.name, config: { urls: parsed.data.urls, keywords: parsed.data.keywords, terms_url: parsed.data.terms_url } })
      .returning({ id: feeds.id });
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "feed.created", entityType: "feed", entityId: feed!.id, after: { source_type: parsed.data.source_type, name: parsed.data.name } });
  });
  redirect(`${SOURCES}?notice=feed_added`);
}

export async function saveApolloKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSettings();
  const key = String(formData.get("apollo_api_key") ?? "").trim();
  if (key.length < 10) return { message: "Check this field: Apollo API key.", fieldErrors: { apollo_api_key: "Paste the full key from Apollo's API settings." } };
  try {
    await withWorkspace(ctx.workspace.id, (tx) => setWorkspaceSecret(tx, ctx.workspace.id, "apollo_api_key", key, ctx.user.id));
  } catch (error) {
    if (error instanceof EncryptionConfigError) return { message: `Couldn't save the key: ${error.message}` };
    throw error;
  }
  redirect(`${SOURCES}?notice=apollo_key_saved`);
}

export interface UploadResult extends FormState {
  report?: { events: number; rejected: number; created: number; duplicates: number; suppressed: number };
}

/** Newsletter CSV: ingested and applied immediately on upload (BRD 8.6). */
export async function uploadNewsletterAction(_prev: UploadResult, formData: FormData): Promise<UploadResult> {
  const ctx = await requireSettings();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Check this field: file.", fieldErrors: { file: "Choose a CSV file to upload." } };
  if (file.size > 5 * 1024 * 1024) return { message: "Check this field: file.", fieldErrors: { file: "The file is larger than 5 MB. Split it into smaller files." } };
  const text = await file.text();
  let parsed;
  try {
    parsed = parseNewsletterCsv(text);
  } catch (error) {
    if (error instanceof NewsletterCsvError) return { message: "Check this field: file.", fieldErrors: { file: error.message } };
    throw error;
  }
  const run = await runSource(ctx.workspace.id, "newsletter", { newsletterCsv: text });
  if (run.skipped === "flag_off") return { message: "Newsletter import is switched off for this workspace." };
  if (run.skipped === "no_feeds") return { message: "Add a newsletter source before uploading." };
  const feed = run.feeds[0]!;
  if (!feed.ok) return { message: `Couldn't import the file: ${feed.error}` };
  return { report: { events: parsed.rows.length, rejected: parsed.rejected.length, created: feed.created, duplicates: feed.duplicates, suppressed: feed.suppressed } };
}
