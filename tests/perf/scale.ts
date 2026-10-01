/**
 * Fills a workspace to the BRD 19 scale ceiling: 2,000 companies and 50,000 people, with the rows a
 * busy workspace has around them (roles, past roles, field sources, interactions, signals, scores,
 * connections and audit entries). Plain SQL in bulk, as the schema owner inside the workspace scope,
 * so row-level security still applies. For the performance check only.
 */
import { Pool } from "pg";

const FIRST = ["Ada", "Bram", "Cora", "Dmitri", "Elena", "Farid", "Greta", "Hugo", "Ines", "Jonas", "Kira", "Luca", "Mara", "Nils", "Odile", "Pavel", "Quinn", "Rosa", "Soren", "Talia", "Umar", "Vera", "Wyatt", "Xenia", "Yusuf", "Zara", "Amara", "Bastien", "Celia", "Dario", "Esme", "Felix", "Gemma", "Henrik", "Ivy", "Jasper", "Leona", "Milo", "Nadia", "Oskar"];
const SYLLABLES = ["ash", "brook", "cal", "dun", "ell", "fair", "gold", "hart", "iver", "kel", "lind", "mor", "north", "old", "pem", "quill", "rad", "stan", "thorn", "wex"];
const ENDINGS = ["ford", "ton", "wood", "ley", "by", "well", "more", "field", "worth", "stead"];

/** 40 first names by 4,000 family names: 160,000 distinct full names, the first 50,000 used. */
function names(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count; i++) {
    const family = SYLLABLES[i % 20]! + SYLLABLES[Math.floor(i / 20) % 20]! + ENDINGS[Math.floor(i / 400) % 10]!;
    out.push(`${FIRST[Math.floor(i / 4000) % 40]!} ${family[0]!.toUpperCase()}${family.slice(1)}`);
  }
  return out;
}

export interface ScaleResult {
  people: number;
  companies: number;
  ms: number;
}

export async function fillToScale(migrateUrl: string, workspaceId: string, partnerUserId: string, target = { people: 50_000, companies: 2_000 }): Promise<ScaleResult> {
  const started = Date.now();
  const pool = new Pool({ connectionString: migrateUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("select set_config('app.workspace_id', $1, false)", [workspaceId]);
    const count = async (table: string) => Number((await client.query(`select count(*)::int as n from dmi.${table}`)).rows[0].n);
    const addCompanies = target.companies - (await count("companies"));
    const addPeople = target.people - (await count("persons"));

    await client.query(
      `insert into dmi.companies (workspace_id, name, name_normalised, domain, ownership, hq_country, industry, employee_count, size_band, target_tier, client_status)
       select $1, 'Perfco ' || g || ' Holdings', 'perfco ' || g || ' holdings', 'perfco-' || g || '.example.com',
              (array['public','pe_backed','private'])[1 + g % 3]::dmi.ownership_type, 'US',
              (array['Industrials','Healthcare','Technology','Financials'])[1 + g % 4], 500 + g, '1000_4999', 1 + g % 3, 'prospect'
       from generate_series(1, $2::int) g`,
      [workspaceId, addCompanies],
    );

    const all = names(addPeople);
    for (let i = 0; i < all.length; i += 5_000) {
      const chunk = all.slice(i, i + 5_000);
      await client.query(
        `insert into dmi.persons (workspace_id, full_name, name_normalised, linkedin_url, city, country, contact_types)
         select $1, n, lower(n), 'https://www.linkedin.com/in/perf-' || ($3::int + i), 'Boston', 'US', '{prospective_client}'
         from unnest($2::text[]) with ordinality as t(n, i)`,
        [workspaceId, chunk, i],
      );
    }

    // Numbered once, so every later statement can pair people with companies by number.
    await client.query(`create temp table perf_people as select id, full_name, row_number() over (order by id) as rn from dmi.persons where linkedin_url like 'https://www.linkedin.com/in/perf-%'`);
    await client.query(`create temp table perf_companies as select id, domain, row_number() over (order by id) as rn, count(*) over () as n from dmi.companies`);
    await client.query(`create index on perf_people (rn); create index on perf_companies (rn); analyze perf_people; analyze perf_companies`);

    // A current primary role for everyone, and a past role for every second person.
    await client.query(
      `insert into dmi.roles (workspace_id, person_id, company_id, seat_type, title, title_normalised, function, seniority, business_email, email_status, effective_on, status, is_primary)
       select $1, p.id, c.id, 'executive', t.title, t.norm, t.fn, t.sen::dmi.seniority, lower(replace(p.full_name, ' ', '.')) || '.' || p.rn || '@' || c.domain, 'verified',
              date '2018-01-01' + (p.rn % 2000)::int, 'current', true
       from perf_people p
       join perf_companies c on c.rn = 1 + (p.rn % (select max(n) from perf_companies))
       join (values (0, 'Chief Executive Officer', 'CEO', 'General Management', 'c_suite'), (1, 'Chief Financial Officer', 'CFO', 'Finance', 'c_suite'),
                    (2, 'Chief Human Resources Officer', 'CHRO', 'Human Resources', 'c_suite'), (3, 'Senior Vice President, Operations', 'SVP Operations', 'Operations', 'svp'),
                    (4, 'Vice President, Technology', 'VP Technology', 'Technology', 'vp')) t(k, title, norm, fn, sen) on t.k = p.rn % 5`,
      [workspaceId],
    );
    await client.query(
      `insert into dmi.roles (workspace_id, person_id, company_id, seat_type, title, title_normalised, seniority, business_email, email_status, effective_on, ended_on, status, is_primary)
       select $1, p.id, c.id, 'executive', 'Vice President', 'VP', 'vp', lower(replace(p.full_name, ' ', '.')) || '.' || p.rn || '@old.' || c.domain, 'verified',
              date '2012-01-01' + (p.rn % 1500)::int, date '2017-06-01' + (p.rn % 180)::int, 'ended', false
       from perf_people p join perf_companies c on c.rn = 1 + ((p.rn * 7) % (select max(n) from perf_companies))
       where p.rn % 2 = 0`,
      [workspaceId],
    );

    // Provenance: two field sources per person and two per primary role.
    await client.query(
      `insert into dmi.field_sources (workspace_id, entity_type, entity_id, field, value, source_type, confidence)
       select $1, 'person', p.id, f.field, case f.field when 'full_name' then p.full_name else 'https://www.linkedin.com/in/perf-' || p.rn end, 'manual', 'medium'
       from perf_people p cross join (values ('full_name'), ('linkedin_url')) f(field)`,
      [workspaceId],
    );
    await client.query(
      `insert into dmi.field_sources (workspace_id, entity_type, entity_id, field, value, source_type, confidence)
       select $1, 'role', r.id, f.field, case f.field when 'title' then r.title else r.business_email end, 'apollo', 'high'
       from dmi.roles r join perf_people p on p.id = r.person_id cross join (values ('title'), ('business_email')) f(field)
       where r.is_primary`,
      [workspaceId],
    );

    // Five interactions each over two years, a firm score each, a confirmed signal for every fourth.
    await client.query(
      `insert into dmi.interactions (workspace_id, person_id, channel, direction, occurred_at, our_user_id, subject, thread_key, provider, external_id, captured_by)
       select $1, p.id, (array['email','meeting','call']::dmi.channel[])[1 + k % 3], (array['outbound','inbound','two_way']::dmi.direction[])[1 + (p.rn + k) % 3],
              now() - ((k * 120 + p.rn % 90) || ' days')::interval, $2, 'Perf conversation ' || k, 'perf-thread-' || p.rn, 'perf', 'perf-' || p.rn || '-' || k, 'auto'
       from perf_people p cross join generate_series(1, 5) k`,
      [workspaceId, partnerUserId],
    );
    await client.query(
      `insert into dmi.relationship_scores (workspace_id, person_id, user_id, score, band, factors, last_two_way_at)
       select $1, p.id, null, s.score, case when s.score >= 70 then 'strong' when s.score >= 45 then 'warm' when s.score >= 25 then 'cooling' when s.score >= 1 then 'cold' else 'none' end::dmi.band,
              jsonb_build_object(
                'recency', jsonb_build_object('raw', jsonb_build_object('daysSinceLastTwoWay', p.rn % 200), 'value', 0.5),
                'frequency', jsonb_build_object('raw', jsonb_build_object('twoWayTouches12m', 3), 'value', 0.4),
                'reciprocity', jsonb_build_object('raw', jsonb_build_object('inboundThreads12m', 1, 'threads12m', 2), 'value', 0.5),
                'depth', jsonb_build_object('raw', jsonb_build_object('meetings', 1, 'calls', 1, 'emailThreads', 2, 'linkedinUnits', 0), 'value', 0.3),
                'tenure', jsonb_build_object('raw', jsonb_build_object('yearsSinceFirstTwoWay', 2.5), 'value', 0.6)), now() - ((p.rn % 200) || ' days')::interval
       from perf_people p cross join lateral (select ((p.rn * 37) % 100)::smallint as score) s`,
      [workspaceId],
    );
    await client.query(
      `with s as (
         insert into dmi.signals (workspace_id, subject_type, person_id, type, headline, found_at, found_by, confidence, priority, lane, status, confirmed_at, dedupe_key)
         select $1, 'person', p.id, 'person_promotion', p.full_name || ' promoted', now() - ((p.rn % 60) || ' days')::interval, 'ai_scan', 'high', 2, 'review', 'confirmed', now() - ((p.rn % 60) || ' days')::interval, 'perf:' || p.rn
         from perf_people p where p.rn % 4 = 0
         returning id, headline
       )
       insert into dmi.signal_sources (workspace_id, signal_id, source_type, url, title)
       select $1, s.id, 'press_wire', 'https://example.com/news/' || s.id, s.headline from s`,
      [workspaceId],
    );

    // Colleagues at the same company know each other: one tie per neighbouring pair.
    await client.query(
      `insert into dmi.connections (workspace_id, person_a_id, person_b_id, type, company_id, weight, derived)
       select distinct on (least(a.person_id, b.person_id), greatest(a.person_id, b.person_id))
              $1, least(a.person_id, b.person_id), greatest(a.person_id, b.person_id), 'overlapping_tenure', a.company_id, 0.6, true
       from (select person_id, company_id, row_number() over (partition by company_id order by person_id) as k from dmi.roles where is_primary) a
       join (select person_id, company_id, row_number() over (partition by company_id order by person_id) as k from dmi.roles where is_primary) b
         on b.company_id = a.company_id and b.k = a.k + 1`,
      [workspaceId],
    );

    await client.query(
      `insert into dmi.audit_log (workspace_id, actor_user_id, actor_kind, action, entity_type, entity_id, after)
       select $1, $2, 'user', 'person.created', 'person', p.id, jsonb_build_object('full_name', p.full_name) from perf_people p`,
      [workspaceId, partnerUserId],
    );
    await client.query("analyze");
    return { people: await count("persons"), companies: await count("companies"), ms: Date.now() - started };
  } finally {
    client.release();
    await pool.end();
  }
}
