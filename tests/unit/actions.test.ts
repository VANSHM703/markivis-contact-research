import { describe, expect, it } from "vitest";
import { dueDate, purposeForType } from "@/domain/actions";
import { BLOCK_NOTES, evaluateChecks, isCandidateApproach, isEuEeaUk, ruleActive, ruleCovers, type CheckFacts, type OffLimitsRule } from "@/domain/checks";
import { composeDigest, type DigestSection } from "@/digest/digest";
import { digestCron } from "@/jobs/definitions";
import { endOfLocalDay, escalatesAt, localDate, startOfLocalDay } from "@/lib/working-days";

const TODAY = "2026-09-30";
const facts = (over: Partial<CheckFacts> = {}): CheckFacts => ({
  status: "active",
  suppressed: false,
  country: "US",
  contactTypes: ["prospective_client"],
  emailConsent: "unknown",
  linkedinConsent: "unknown",
  hasVerifiedEmail: true,
  employment: [],
  ...over,
});
const companyRule: OffLimitsRule = { scope: "company", function: null, minSeniority: null, startsOn: "2025-01-01", endsOn: null, companyName: "Client Co" };

describe("pre-action checks (BRD 12.2), in order", () => {
  it("1: do not contact and suppression mean no action", () => {
    expect(evaluateChecks(facts({ status: "do_not_contact" }), "client", TODAY)).toEqual({ kind: "no_action", reason: "do_not_contact" });
    expect(evaluateChecks(facts({ suppressed: true }), "client", TODAY)).toEqual({ kind: "no_action", reason: "suppressed" });
    // Step 1 wins over every later step.
    expect(evaluateChecks(facts({ status: "do_not_contact", country: "DE", employment: [{ function: null, seniority: "c_suite", rules: [companyRule] }] }), "candidate", TODAY).kind).toBe("no_action");
  });

  it("2: an email opt-out moves the draft to LinkedIn; both opted out blocks", () => {
    const r = evaluateChecks(facts({ emailConsent: "opted_out" }), "client", TODAY);
    expect(r).toMatchObject({ kind: "ok", channel: "linkedin_message", emailAllowed: false, linkedinAllowed: true });
    expect(evaluateChecks(facts({ emailConsent: "opted_out", linkedinConsent: "opted_out" }), "client", TODAY)).toMatchObject({ kind: "blocked", reason: "opted_out" });
    // A preferred channel that is opted out is not used.
    expect(evaluateChecks(facts({ emailConsent: "opted_out" }), "client", TODAY, "email")).toMatchObject({ channel: "linkedin_message" });
  });

  it("3: EU, EEA and UK people need a lawful basis for email (scenario 17)", () => {
    expect(evaluateChecks(facts({ country: "DE" }), "client", TODAY)).toEqual({ kind: "blocked", reason: "lawful_basis", note: BLOCK_NOTES.lawful_basis });
    expect(evaluateChecks(facts({ country: "GB" }), "client", TODAY).kind).toBe("blocked");
    expect(evaluateChecks(facts({ country: "NO" }), "client", TODAY).kind).toBe("blocked");
    expect(evaluateChecks(facts({ country: "DE", emailConsent: "legitimate_interest" }), "client", TODAY).kind).toBe("ok");
    expect(evaluateChecks(facts({ country: "US" }), "client", TODAY).kind).toBe("ok");
    expect(isEuEeaUk("ch")).toBe(false);
    expect(isEuEeaUk("ie")).toBe(true);
  });

  it("4: off-limits blocks candidate approaches only (scenario 16)", () => {
    const employed = facts({ employment: [{ function: "Finance", seniority: "c_suite", rules: [companyRule] }] });
    expect(evaluateChecks(employed, "candidate", TODAY)).toMatchObject({ kind: "blocked", reason: "off_limits", note: BLOCK_NOTES.off_limits("Client Co") });
    expect(evaluateChecks(employed, "client", TODAY).kind).toBe("ok");
    // Someone known only as a candidate is approached as a candidate whatever the purpose.
    expect(evaluateChecks({ ...employed, contactTypes: ["potential_candidate"] }, "client", TODAY).kind).toBe("blocked");
    expect(isCandidateApproach("client", ["potential_candidate", "referrer"])).toBe(false);
    expect(isCandidateApproach("client", [])).toBe(false);
    expect(purposeForType("invite_interview")).toBe("candidate");
    expect(purposeForType("check_in")).toBe("client");
  });

  it("covers function and seniority rules, within their dates", () => {
    const fn: OffLimitsRule = { ...companyRule, scope: "function", function: "Finance" };
    const level: OffLimitsRule = { ...companyRule, scope: "level_and_above", minSeniority: "svp" };
    expect(ruleCovers(fn, { function: "finance", seniority: "vp" })).toBe(true);
    expect(ruleCovers(fn, { function: "Legal", seniority: "vp" })).toBe(false);
    expect(ruleCovers(level, { function: null, seniority: "c_suite" })).toBe(true);
    expect(ruleCovers(level, { function: null, seniority: "vp" })).toBe(false);
    expect(ruleActive({ startsOn: "2026-10-01", endsOn: null }, TODAY)).toBe(false);
    expect(ruleActive({ startsOn: "2025-01-01", endsOn: "2026-09-29" }, TODAY)).toBe(false);
    expect(ruleActive({ startsOn: "2025-01-01", endsOn: TODAY }, TODAY)).toBe(true);
  });

  it("prefers a verified email, else LinkedIn", () => {
    expect(evaluateChecks(facts(), "client", TODAY)).toMatchObject({ channel: "email" });
    expect(evaluateChecks(facts({ hasVerifiedEmail: false }), "client", TODAY)).toMatchObject({ channel: "linkedin_message" });
    expect(evaluateChecks(facts(), "client", TODAY, "linkedin_message")).toMatchObject({ channel: "linkedin_message" });
  });
});

describe("service levels across weekends (BRD 12.8)", () => {
  const NY = "America/New_York";
  const friday = new Date("2026-10-02T15:00:00Z");

  it("priority 1 is due 2 working days later, priority 2 five, at 17:00 local", () => {
    expect(dueDate({ priority: 1, type: "person_left", effectiveOn: null }, friday, {}, NY).toISOString()).toBe("2026-10-06T21:00:00.000Z");
    expect(dueDate({ priority: 2, type: "person_promotion", effectiveOn: null }, friday, {}, NY).toISOString()).toBe("2026-10-09T21:00:00.000Z");
    expect(dueDate({ priority: 1, type: "person_left", effectiveOn: null }, friday, { sla: { p1_working_days: 1 } }, NY).toISOString()).toBe("2026-10-05T21:00:00.000Z");
  });

  it("an announced move is due 2 working days before it starts, or the P1 default if sooner", () => {
    expect(dueDate({ priority: 1, type: "person_move_announced", effectiveOn: "2026-11-02" }, friday, {}, NY).toISOString()).toBe("2026-10-29T21:00:00.000Z");
    expect(dueDate({ priority: 1, type: "person_move_announced", effectiveOn: "2026-10-06" }, friday, {}, NY).toISOString()).toBe("2026-10-06T21:00:00.000Z");
  });

  it("escalates one working day after the due date", () => {
    expect(escalatesAt(new Date("2026-10-02T21:00:00Z"), NY).toISOString()).toBe("2026-10-05T21:00:00.000Z");
  });

  it("local day helpers follow the time zone", () => {
    expect(localDate(new Date("2026-10-01T02:00:00Z"), NY)).toBe("2026-09-30");
    expect(startOfLocalDay(new Date("2026-10-01T02:00:00Z"), NY).toISOString()).toBe("2026-09-30T04:00:00.000Z");
    expect(endOfLocalDay(new Date("2026-10-01T02:00:00Z"), NY).toISOString()).toBe("2026-10-01T03:59:00.000Z");
  });
});

describe("digest composition (BRD 12.8, scenario 21)", () => {
  const empty = (key: DigestSection["key"], title: string): DigestSection => ({ key, title, lines: [] });

  it("sends nothing when every section is empty", () => {
    expect(composeDigest("Demo", "Sep 30, 2026", [empty("actions", "A"), empty("approvals", "B")])).toBeNull();
  });

  it("leaves out empty sections and keeps the order", () => {
    const digest = composeDigest("Demo", "Sep 30, 2026", [
      { key: "actions", title: "Actions due today and overdue", lines: ["One"] },
      empty("approvals", "Drafts awaiting approval"),
      { key: "outcomes", title: "Outcomes to record", lines: ["Two", "Three"] },
    ]);
    expect(digest!.subject).toBe("Your day in Demo: Sep 30, 2026");
    expect(digest!.text).not.toContain("Drafts awaiting approval");
    expect(digest!.text.indexOf("Actions due today")).toBeLessThan(digest!.text.indexOf("Outcomes to record (2)"));
    expect(digest!.text).not.toMatch(/[\u2013\u2014]/);
  });

  it("turns the digest time into a cron", () => {
    expect(digestCron({ digest_time: "08:00" })).toBe("0 8 * * *");
    expect(digestCron({ digest_time: "17:45" })).toBe("45 17 * * *");
    expect(digestCron({ digest_time: "25:00" })).toBe("0 8 * * *");
    expect(digestCron({})).toBe("0 8 * * *");
  });
});
