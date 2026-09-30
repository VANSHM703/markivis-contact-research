import { describe, expect, it } from "vitest";
import { BRIEF_HEADINGS, briefMarkdown, briefOutputSchema, NOTHING_ON_RECORD } from "@/ai/contracts";
import { BAND_PROPERTY, createHubSpotAdapter, HUBSPOT } from "@/crm/hubspot";
import { mockHttp, ok, type HttpRequest } from "@/ingest/http";
import { gmailSender, graphSender, rfc2822 } from "@/outreach/mailbox";

const brief = {
  who_they_are: "Jane Example, Chief Financial Officer at Example Holdings.",
  what_changed_recently: "",
  our_history: "Six interactions this year; the latest was a meeting on 2026-09-20.",
  what_they_care_about: "CFO agenda.",
  mutual_connections: "",
  open_items: "A check-in is due on 2026-10-02.",
  suggested_talking_points: ["Ask how the audit went.", "Share the CFO agenda paper.", "Agree a next step."],
};

describe("meeting brief (BRD 12.6, 17.3, scenario 20)", () => {
  it("renders exactly the seven headings in order, with Nothing on record for empty sections", () => {
    const md = briefMarkdown(briefOutputSchema.parse(brief));
    expect(md.match(/^## .+$/gm)).toEqual(BRIEF_HEADINGS.map((h) => `## ${h}`));
    expect(md.split(`## What changed recently\n\n`)[1]!.startsWith(NOTHING_ON_RECORD)).toBe(true);
    expect(md).toContain("- Ask how the audit went.");
  });
  it("rejects a section over 80 words, or other than three talking points", () => {
    expect(briefOutputSchema.safeParse({ ...brief, our_history: Array(81).fill("word").join(" ") }).success).toBe(false);
    expect(briefOutputSchema.safeParse({ ...brief, suggested_talking_points: ["One.", "Two."] }).success).toBe(false);
  });
});

describe("sending from the partner's mailbox (BRD 12.5)", () => {
  const message = { fromUserId: "u", fromEmail: "partner@firm.example.com", to: "jane@client.example.com", subject: "Congratulations", body: "Dear Jane,\n\nWell done.\n\nJordan" };

  it("Graph: POST /me/sendMail with a plain-text body and no provisional thread", async () => {
    let seen: HttpRequest | null = null;
    const http = mockHttp((req) => ((seen = req), { status: 202, headers: {}, text: "" }));
    const sent = await graphSender(http, async () => "t").send(message);
    expect(seen!.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(seen!.body).toEqual({ message: { subject: "Congratulations", body: { contentType: "Text", content: message.body }, toRecipients: [{ emailAddress: { address: message.to } }] }, saveToSentItems: true });
    expect(sent).toMatchObject({ provider: "microsoft", threadKey: null });
    expect(sent.messageId).toMatch(/^sent:/);
  });

  it("Gmail: POST messages/send with an RFC 2822 message, keeping the returned thread", async () => {
    const http = mockHttp((req) => (req.url.endsWith("/messages/send") ? ok(JSON.stringify({ id: "g1", threadId: "t1" })) : undefined));
    expect(await gmailSender(http, async () => "t").send(message)).toEqual({ provider: "google", messageId: "sent:g1", threadKey: "t1" });
    const decoded = Buffer.from(rfc2822(message).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("To: jane@client.example.com\r\n");
    expect(decoded).toContain("Subject: Congratulations\r\n");
    expect(decoded.endsWith(message.body)).toBe(true);
    expect(rfc2822({ ...message, subject: "Félicitations" })).toBeTruthy();
  });
});

describe("HubSpot adapter (BRD 15)", () => {
  it("upserts contacts by email in batches of 100 and creates missing custom properties", async () => {
    const calls: HttpRequest[] = [];
    const http = mockHttp((req) => {
      calls.push(req);
      if (req.method === "GET") return { status: 404, headers: {}, text: "" };
      if (req.url.endsWith("/batch/upsert")) {
        const inputs = (req.body as { inputs: { id: string }[] }).inputs;
        return ok(JSON.stringify({ results: inputs.map((i, n) => ({ id: `c${n}`, properties: { email: i.id } })) }));
      }
      return ok(JSON.stringify({}));
    });
    const hs = createHubSpotAdapter(http, "token");
    await hs.ensureProperties();
    expect(calls.filter((c) => c.method === "POST" && c.url === `${HUBSPOT}/crm/v3/properties/contacts`).map((c) => (c.body as { name: string }).name)).toEqual([BAND_PROPERTY, "dmi_last_two_way_touch"]);
    const people = Array.from({ length: 150 }, (_, i) => ({ email: `p${i}@example.com`, firstName: "P", lastName: String(i), jobTitle: "CFO", company: "Example", band: "warm", lastTwoWayAt: new Date("2026-09-01T10:00:00Z") }));
    const ids = await hs.upsertContacts(people);
    const upserts = calls.filter((c) => c.url.endsWith("/batch/upsert"));
    expect(upserts.map((c) => (c.body as { inputs: unknown[] }).inputs.length)).toEqual([100, 50]);
    expect((upserts[0]!.body as { inputs: { idProperty: string; properties: Record<string, string> }[] }).inputs[0]).toMatchObject({ idProperty: "email", properties: { [BAND_PROPERTY]: "warm", dmi_last_two_way_touch: String(Date.UTC(2026, 8, 1)) } });
    expect(ids.size).toBe(150);
    expect(calls.every((c) => c.headers?.authorization === "Bearer token")).toBe(true);
  });

  it("associates notes with the contact and pages through changed contacts", async () => {
    let noteBody: unknown = null;
    let page = 0;
    const http = mockHttp((req) => {
      if (req.url.endsWith("/objects/notes")) return ((noteBody = req.body), ok(JSON.stringify({ id: "n1" })));
      if (req.url.endsWith("/contacts/search")) {
        page++;
        return ok(JSON.stringify({ results: [{ id: `c${page}`, properties: { email: `X${page}@Example.com`, jobtitle: "CEO", hs_email_optout: page === 2 ? "true" : "false" }, updatedAt: "2026-09-30T10:00:00Z" }], ...(page === 1 ? { paging: { next: { after: "1" } } } : {}) }));
      }
      return undefined;
    });
    const hs = createHubSpotAdapter(http, "t");
    expect(await hs.createNote({ contactCrmId: "c9", at: new Date("2026-09-30T10:00:00Z"), body: "Met for coffee" })).toBe("n1");
    expect(noteBody).toMatchObject({ associations: [{ to: { id: "c9" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] });
    const changed = await hs.contactsModifiedSince(new Date("2026-09-01T00:00:00Z"));
    expect(changed.map((c) => [c.email, c.emailOptOut])).toEqual([["x1@example.com", false], ["x2@example.com", true]]);
  });
});
