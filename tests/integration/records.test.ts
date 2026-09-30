/**
 * Records, matching and movement rules (BRD 7), including acceptance scenarios 4 and 5.
 * Every test runs in a transaction that is rolled back.
 */
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { mergePersons, unmergePerson } from "@/domain/merge";
import { addRole, createCompany, endRole, upsertPerson, type Actor, type SourceNote } from "@/domain/records";
import { resolveConflict, resolveDuplicate } from "@/domain/queue-items";
import { addSuppression, SuppressedError } from "@/domain/suppression";
import { commitTargetList, previewTargetList, readTargetListFile } from "@/domain/imports/target-list";
import { inRolledBackWorkspace, loadFixtures, type WorkspaceFixture } from "./helpers";

let demo: WorkspaceFixture;
let actor: Actor;
const manual: SourceNote = { sourceType: "manual", note: "Met at a conference" };

beforeAll(async () => {
  ({ demo } = await loadFixtures());
  actor = { workspaceId: demo.id, userId: demo.partnerUserId };
});
afterAll(() => closeDatabase());

async function personWithRole(tx: Tx) {
  const [row] = await tx
    .select({ person: s.persons, role: s.roles })
    .from(s.persons)
    .innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true), eq(s.roles.seatType, "executive")))
    .where(isNull(s.persons.mergedIntoId))
    .limit(1);
  return row!;
}

const countPeople = async (tx: Tx) => (await tx.select({ n: count() }).from(s.persons))[0]!.n;
const pendingItems = (tx: Tx, kind: "possible_duplicate" | "data_conflict") =>
  tx.select().from(s.queueItems).where(and(eq(s.queueItems.kind, kind), eq(s.queueItems.status, "pending")));

describe("matching order (BRD 7.2)", () => {
  it("step 1: an exact LinkedIn URL is the same person", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person } = await personWithRole(tx);
      const result = await upsertPerson(tx, actor, { fullName: "Someone Else Entirely", linkedinUrl: `${person.linkedinUrl}/` }, [], manual);
      expect(result).toEqual({ outcome: "matched", personId: person.id, step: 1 });
    });
  });

  it("step 2: a business email on any role is the same person", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person, role } = await personWithRole(tx);
      const company = await createCompany(tx, actor, { name: "Fresh Example Co" }, manual);
      const result = await upsertPerson(tx, actor, { fullName: "Different Name" }, [{ companyId: company, title: "Advisor", businessEmail: role.businessEmail!.toUpperCase() }], manual);
      expect(result).toEqual({ outcome: "matched", personId: person.id, step: 2 });
    });
  });

  it("step 3: same name and a role at the same company with the same title is the same person, and is logged", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person, role } = await personWithRole(tx);
      const result = await upsertPerson(tx, actor, { fullName: person.fullName.toUpperCase() }, [{ companyId: role.companyId, title: role.title }], manual);
      expect(result).toEqual({ outcome: "matched", personId: person.id, step: 3 });
      const logged = await tx.select().from(s.auditLog).where(and(eq(s.auditLog.action, "person.matched"), eq(s.auditLog.entityId, person.id)));
      expect(logged.length).toBe(1);
    });
  });

  it("scenario 4: same name and city with no email or LinkedIn match creates a possible duplicate and never merges", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person } = await personWithRole(tx);
      const before = await countPeople(tx);
      const csv = `company_name,person_full_name,person_title,person_city\nUnrelated Example Industries,${person.fullName},Advisor,${person.city}\n`;
      const file = readTargetListFile(csv);
      const preview = await previewTargetList(tx, demo.id, file.rows, file.unknownColumns);
      expect(preview.rows[0]!.person).toBe("possible_duplicate");
      const [batch] = await tx.insert(s.importBatches).values({ workspaceId: demo.id, kind: "target_list", filename: "t.csv", rows: preview.rows, createdBy: demo.partnerUserId }).returning();
      const report = await commitTargetList(tx, actor, batch!.id, preview.rows, manual);

      expect(report.possibleDuplicates).toBe(1);
      expect(await countPeople(tx)).toBe(before + 1);
      const items = await pendingItems(tx, "possible_duplicate");
      const item = items.find((i) => (i.payload as { person_ids: string[] }).person_ids.includes(person.id));
      expect(item).toBeDefined();
      const merged = await tx.select({ n: count() }).from(s.persons).where(eq(s.persons.mergedIntoId, person.id));
      expect(merged[0]!.n).toBe(0);
      const [original] = await tx.select().from(s.persons).where(eq(s.persons.id, person.id));
      expect(original!.mergedIntoId).toBeNull();
    });
  });

  it("step 5: no match creates a new person", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const company = await createCompany(tx, actor, { name: "Brand New Example LLC" }, manual);
      const result = await upsertPerson(tx, actor, { fullName: "Quillon Vantessa", city: "Nowhere" }, [{ companyId: company, title: "Chief Financial Officer" }], manual);
      expect(result.outcome).toBe("created");
    });
  });

  it("refuses a suppressed person before creating anything", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      await addSuppression(tx, demo.id, "email", "gone.person@suppressed.example.com", "erasure");
      const company = await createCompany(tx, actor, { name: "Suppression Example" }, manual);
      const before = await countPeople(tx);
      await expect(
        upsertPerson(tx, actor, { fullName: "Gone Person" }, [{ companyId: company, title: "CEO", businessEmail: "Gone.Person@suppressed.example.com" }], manual),
      ).rejects.toBeInstanceOf(SuppressedError);
      expect(await countPeople(tx)).toBe(before);
    });
  });
});

describe("movement rules (BRD 7.3)", () => {
  it("scenario 5: ending one of two current board seats keeps the person active and the other seat current", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const boardRoles = await tx.select().from(s.roles).where(and(eq(s.roles.seatType, "board"), eq(s.roles.status, "current")));
      const byPerson = new Map<string, typeof boardRoles>();
      for (const r of boardRoles) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);
      const [personId, seats] = [...byPerson.entries()].find(([, rs]) => rs.length === 2)!;
      const [leaving, staying] = seats;

      await endRole(tx, actor, leaving!.id, "2026-09-15", { sourceType: "sec_8k", sourceUrl: "https://www.sec.gov/example", confidence: "high" });

      const [person] = await tx.select().from(s.persons).where(eq(s.persons.id, personId));
      expect(person!.status).toBe("active");
      const after = await tx.select().from(s.roles).where(inArray(s.roles.id, [leaving!.id, staying!.id]));
      expect(after.find((r) => r.id === leaving!.id)!.status).toBe("ended");
      expect(after.find((r) => r.id === staying!.id)!.status).toBe("current");
      expect(after.find((r) => r.id === staying!.id)!.isPrimary).toBe(true);
    });
  });

  it("marks a person no_current_role only 90 days after their last role ended", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const company = await createCompany(tx, actor, { name: "Status Example" }, manual);
      const recent = await upsertPerson(tx, actor, { fullName: "Recent Leaver" }, [{ companyId: company, title: "CFO" }], manual);
      const old = await upsertPerson(tx, actor, { fullName: "Long Gone" }, [{ companyId: company, title: "COO" }], manual);
      const roleOf = async (id: string) => (await tx.select().from(s.roles).where(eq(s.roles.personId, id)))[0]!.id;
      const today = new Date();
      const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
      await endRole(tx, actor, await roleOf(recent.personId), daysAgo(10), manual);
      await endRole(tx, actor, await roleOf(old.personId), daysAgo(120), manual);
      const statuses = await tx.select({ id: s.persons.id, status: s.persons.status }).from(s.persons).where(inArray(s.persons.id, [recent.personId, old.personId]));
      expect(statuses.find((p) => p.id === recent.personId)!.status).toBe("active");
      expect(statuses.find((p) => p.id === old.personId)!.status).toBe("no_current_role");
    });
  });

  it("primary role: the most senior current executive role wins over board seats", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const a = await createCompany(tx, actor, { name: "Primary Example A" }, manual);
      const b = await createCompany(tx, actor, { name: "Primary Example B" }, manual);
      const { personId } = await upsertPerson(tx, actor, { fullName: "Primary Tester" }, [{ companyId: a, title: "Independent Director" }], manual);
      const vp = await addRole(tx, actor, personId, { companyId: b, title: "VP, Finance" }, manual);
      const ceo = await addRole(tx, actor, personId, { companyId: a, title: "Chief Executive Officer" }, manual);
      const primary = await tx.select({ id: s.roles.id }).from(s.roles).where(and(eq(s.roles.personId, personId), eq(s.roles.isPrimary, true)));
      expect(primary.map((r) => r.id)).toEqual([ceo.roleId]);
      expect(vp.created).toBe(true);
    });
  });
});

describe("provenance and conflicts (BRD 6.3)", () => {
  it("keeps both values when two sources disagree, keeps showing the existing value on a confidence tie, and raises a conflict", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person, role } = await personWithRole(tx);
      const before = (await pendingItems(tx, "data_conflict")).length;
      // The seed recorded this email from Apollo at high confidence; a leadership page, also high,
      // now reports a different one. On a tie the value already shown stays.
      await addRole(tx, actor, person.id, { companyId: role.companyId, title: role.title, effectiveOn: role.effectiveOn, businessEmail: "other.address@elsewhere.example.com" }, { sourceType: "leadership_page", confidence: "high" });
      const sources = await tx.select().from(s.fieldSources).where(and(eq(s.fieldSources.entityId, role.id), eq(s.fieldSources.field, "business_email")));
      expect(sources.length).toBe(2);
      expect(sources.every((f) => f.inConflict)).toBe(true);
      expect(sources.find((f) => f.isCurrent)!.value).toBe(role.businessEmail);
      const conflicts = await pendingItems(tx, "data_conflict");
      expect(conflicts.length).toBe(before + 1);

      // A validator picks the leadership page's value.
      const incoming = sources.find((f) => !f.isCurrent)!;
      await resolveConflict(tx, actor, conflicts.at(-1)!.id, incoming.id);
      const [roleAfter] = await tx.select().from(s.roles).where(eq(s.roles.id, role.id));
      expect(roleAfter!.businessEmail).toBe("other.address@elsewhere.example.com");
      const resolved = await tx.select().from(s.fieldSources).where(and(eq(s.fieldSources.entityId, role.id), eq(s.fieldSources.field, "business_email")));
      expect(resolved.filter((f) => f.isCurrent).map((f) => f.value)).toEqual(["other.address@elsewhere.example.com"]);
      expect(resolved.some((f) => f.inConflict)).toBe(false);
      expect((await pendingItems(tx, "data_conflict")).length).toBe(before);
    });
  });
});

describe("merge and unmerge (BRD 7.2)", () => {
  it("repoints roles and interactions, hides the merged person, and reverses exactly", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const people = await tx
        .select({ id: s.persons.id })
        .from(s.persons)
        .where(and(isNull(s.persons.mergedIntoId), inArray(s.persons.id, (await tx.select({ id: s.interactions.personId }).from(s.interactions)).map((r) => r.id))))
        .limit(2);
      const [survivor, merged] = people as [{ id: string }, { id: string }];
      const snapshot = async () => ({
        survivorRoles: (await tx.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.personId, survivor.id))).map((r) => r.id).sort(),
        mergedRoles: (await tx.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.personId, merged.id))).map((r) => r.id).sort(),
        mergedInteractions: (await tx.select({ id: s.interactions.id }).from(s.interactions).where(eq(s.interactions.personId, merged.id))).map((r) => r.id).sort(),
        persons: await tx.select().from(s.persons).where(inArray(s.persons.id, [survivor.id, merged.id])).orderBy(s.persons.id),
      });
      const before = await snapshot();

      await mergePersons(tx, actor, survivor.id, merged.id);
      const [hidden] = await tx.select().from(s.persons).where(eq(s.persons.id, merged.id));
      expect(hidden!.mergedIntoId).toBe(survivor.id);
      const survivorInteractions = await tx.select({ id: s.interactions.id }).from(s.interactions).where(eq(s.interactions.personId, survivor.id));
      expect(before.mergedInteractions.every((id) => survivorInteractions.some((r) => r.id === id))).toBe(true);
      expect((await tx.select().from(s.roles).where(eq(s.roles.personId, merged.id))).length).toBe(0);

      await unmergePerson(tx, actor, merged.id);
      const after = await snapshot();
      expect(after.survivorRoles).toEqual(before.survivorRoles);
      expect(after.mergedRoles).toEqual(before.mergedRoles);
      expect(after.mergedInteractions).toEqual(before.mergedInteractions);
      const strip = (p: Record<string, unknown>) => ({ ...p, updatedAt: null });
      expect(after.persons.map(strip)).toEqual(before.persons.map(strip));
    });
  });

  it("resolving a possible duplicate by merging closes the queue item", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person } = await personWithRole(tx);
      const company = await createCompany(tx, actor, { name: "Duplicate Example" }, manual);
      const created = await upsertPerson(tx, actor, { fullName: person.fullName, city: person.city }, [{ companyId: company, title: "Advisor" }], manual);
      expect(created.outcome === "created" && created.possibleDuplicateOf).toEqual([person.id]);
      const item = (await pendingItems(tx, "possible_duplicate")).at(-1)!;
      await resolveDuplicate(tx, actor, item.id, { merge: true, survivorId: person.id });
      const [after] = await tx.select().from(s.queueItems).where(eq(s.queueItems.id, item.id));
      expect(after!.status).toBe("resolved");
      const [hidden] = await tx.select().from(s.persons).where(eq(s.persons.id, created.personId));
      expect(hidden!.mergedIntoId).toBe(person.id);
    });
  });
});

describe("target list import (BRD 16.4)", () => {
  it("previews without writing, then commits and reports created, matched and rejected rows", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const { person, role } = await personWithRole(tx);
      const [company] = await tx.select().from(s.companies).where(eq(s.companies.id, role.companyId));
      const csv = [
        "Company Name,Domain,Tier,Full Name,Title,Email,LinkedIn,City,Contact Types,Start Date",
        `${company!.name},${company!.domain},1,${person.fullName},${role.title},${role.businessEmail},,,prospective_client,`,
        `Vellmoor Example Foods,vellmoor.example.com,2,Ines Example,Chief Financial Officer,ines@vellmoor.example.com,https://www.linkedin.com/in/ines-example-test,Boston,prospective_client; referrer,2024-02-01`,
        `Vellmoor Example Foods,vellmoor.example.com,2,Oren Example,Chief Executive Officer,,,,prospective_client,2021-05-01`,
        `,missing.example.com,,No Company,CEO,,,,,`,
        `Bad Row Example,bad.example.com,7,Bad Person,CEO,not-an-email,,,,2024-13-45`,
      ].join("\n");
      const file = readTargetListFile(csv);
      const peopleBefore = await countPeople(tx);
      const preview = await previewTargetList(tx, demo.id, file.rows, file.unknownColumns);
      expect(await countPeople(tx)).toBe(peopleBefore);
      expect(preview.summary).toMatchObject({ rows: 5, valid: 3, invalid: 2, companiesNew: 1, companiesExisting: 1, peopleNew: 2, peopleMatched: 1 });
      expect(preview.rows[4]!.issues.map((i) => i.column).sort()).toEqual(["company_tier", "person_email", "role_start_date"]);

      const [batch] = await tx.insert(s.importBatches).values({ workspaceId: demo.id, kind: "target_list", filename: "t.csv", rows: preview.rows, createdBy: demo.partnerUserId }).returning();
      const report = await commitTargetList(tx, actor, batch!.id, preview.rows, { sourceType: "manual", note: "Client target list, Sep 2026" });
      expect(report).toMatchObject({ companiesCreated: 1, companiesMatched: 1, peopleCreated: 2, peopleMatched: 1, possibleDuplicates: 0 });
      expect(report.rejected.map((r) => r.rowNumber)).toEqual([5, 6]);
      expect(await countPeople(tx)).toBe(peopleBefore + 2);

      const [ines] = await tx.select().from(s.persons).where(eq(s.persons.fullName, "Ines Example"));
      expect(ines!.contactTypes).toEqual(["prospective_client", "referrer"]);
      const sources = await tx.select().from(s.fieldSources).where(eq(s.fieldSources.entityId, ines!.id));
      expect(sources.every((f) => f.confidence === "medium")).toBe(true);
    });
  });

  it("rejects a file without a company name column", () => {
    expect(() => readTargetListFile("full_name,title\nA,B\n")).toThrow(/company_name/);
  });
});

describe("provenance: confidence decides which value shows", () => {
  it("shows the incoming value when it has higher confidence than the current one", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const company = await createCompany(tx, actor, { name: "Confidence Example" }, { sourceType: "manual" });
      const { personId } = await upsertPerson(tx, actor, { fullName: "Confidence Tester", city: "Denver" }, [{ companyId: company, title: "CFO" }], { sourceType: "google_alert", confidence: "low" });
      const result = await upsertPerson(tx, actor, { fullName: "Confidence Tester", city: "Chicago" }, [{ companyId: company, title: "CFO" }], { sourceType: "leadership_page", confidence: "high" }, { addRolesToMatch: true });
      expect(result).toMatchObject({ outcome: "matched", personId, step: 3 });
      const [person] = await tx.select().from(s.persons).where(eq(s.persons.id, personId));
      expect(person!.city).toBe("Chicago");
    });
  });
});

describe("search (BRD 16.1)", () => {
  it("finds people and companies by partial and misspelt names, as the application role", async () => {
    const { searchCompanies, searchPeople } = await import("@/domain/matching");
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const companies = await searchCompanies(tx, "quarnel");
      expect(companies[0]?.name).toBe("Quarnell Systems, Inc.");
      const [someone] = await tx.select({ fullName: s.persons.fullName }).from(s.persons).limit(1);
      const people = await searchPeople(tx, someone!.fullName.slice(0, -1));
      expect(people.map((p) => p.fullName)).toContain(someone!.fullName);
    });
  });
});
