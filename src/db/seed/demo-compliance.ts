/**
 * Compliance demo data (BRD 18): four former executives who left their roles more than two years
 * ago and have had no contact since, so the retention review has people to keep or erase, and
 * two addresses a newsletter unsubscribe put on the suppression list. All fictional.
 */
import { asc, eq } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { companies, persons, roles } from "@/db/schema";
import { addSuppression } from "@/domain/suppression";
import { normaliseName } from "@/lib/normalise";

const FORMER = [
  { name: "Harriet Vossberg", title: "Chief Financial Officer", norm: "cfo", fn: "Finance", endedMonthsAgo: 27, years: 6 },
  { name: "Ignatius Pell", title: "Chief Operating Officer", norm: "coo", fn: "Operations", endedMonthsAgo: 31, years: 8 },
  { name: "Marguerite Sandvik", title: "Chief Human Resources Officer", norm: "chro", fn: "Human Resources", endedMonthsAgo: 36, years: 5 },
  { name: "Tobias Wrenfield", title: "Chief Technology Officer", norm: "cto", fn: "Technology", endedMonthsAgo: 40, years: 7 },
];

const UNSUBSCRIBED = ["former.reader@example.com", "no.more.mail@example.org"];

const monthsAgo = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

export async function stageDemoCompliance(workspaceId: string, now = new Date()): Promise<{ former: number; suppressed: number }> {
  return withWorkspace(workspaceId, async (tx) => {
    const firms = await tx.select({ id: companies.id }).from(companies).orderBy(asc(companies.name)).limit(FORMER.length);
    let former = 0;
    for (const [i, f] of FORMER.entries()) {
      const slug = f.name.toLowerCase().replace(/[^a-z]+/g, "-");
      const [existing] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.linkedinUrl, `https://www.linkedin.com/in/example-${slug}`)).limit(1);
      if (existing || !firms[i]) continue;
      const [person] = await tx
        .insert(persons)
        .values({ workspaceId, fullName: f.name, nameNormalised: normaliseName(f.name), linkedinUrl: `https://www.linkedin.com/in/example-${slug}`, city: "Boston", region: "MA", country: "US", status: "no_current_role" })
        .returning({ id: persons.id });
      const endedOn = monthsAgo(now, f.endedMonthsAgo);
      await tx.insert(roles).values({
        workspaceId,
        personId: person!.id,
        companyId: firms[i]!.id,
        seatType: "executive",
        title: f.title,
        titleNormalised: f.norm,
        function: f.fn,
        seniority: "c_suite",
        effectiveOn: monthsAgo(now, f.endedMonthsAgo + f.years * 12),
        endedOn,
        status: "ended",
      });
      former++;
    }
    let suppressed = 0;
    for (const email of UNSUBSCRIBED) if (await addSuppression(tx, workspaceId, "email", email, "opt_out")) suppressed++;
    return { former, suppressed };
  });
}
