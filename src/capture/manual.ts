/** "Log interaction" (BRD 16.4): person, channel, date and time, direction, summary, private. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { interactions, persons } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/config/navigation";

export const LOGGABLE_CHANNELS = ["email", "meeting", "call", "linkedin_message", "event", "interview", "note"] as const;
export const DIRECTIONS = ["outbound", "inbound", "two_way", "not_applicable"] as const;

export const logSchema = z.object({
  channel: z.enum(LOGGABLE_CHANNELS, { message: "Choose how you were in touch." }),
  occurredAt: z.coerce.date({ message: "Enter the date and time." }).refine((d) => d.getTime() <= Date.now() + 60_000, "That is in the future. Log an interaction once it has happened."),
  direction: z.enum(DIRECTIONS, { message: "Choose the direction." }),
  summary: z.string().trim().max(2000).optional().transform((v) => v || null),
  subject: z.string().trim().max(300).optional().transform((v) => v || null),
  isPrivate: z.boolean().default(false),
});
export type LogInput = z.infer<typeof logSchema>;

export async function logInteraction(tx: Tx, actor: { workspaceId: string; userId: string; role: WorkspaceRole }, personId: string, input: LogInput): Promise<string> {
  assertCan(actor.role, "records.edit");
  const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person) throw new Error("That person is not in this workspace.");
  const [row] = await tx
    .insert(interactions)
    .values({
      workspaceId: actor.workspaceId,
      personId,
      channel: input.channel,
      direction: input.direction,
      occurredAt: input.occurredAt,
      ourUserId: actor.userId,
      subject: input.subject,
      summary: input.summary,
      provider: "manual",
      externalId: `manual-${randomUUID()}`,
      capturedBy: "manual",
      // Only the partner may mark something private (BRD 5.4).
      isPrivate: input.isPrivate && can(actor.role, "privacy.mark_private"),
    })
    .returning({ id: interactions.id });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "interaction.logged", entityType: "person", entityId: personId, after: { interaction_id: row!.id, channel: input.channel, direction: input.direction } });
  return row!.id;
}
