# Admin guide

Mailbox and calendar capture, sending, HubSpot, the data steward's work (consent, suppression, access requests, erasure, retention, exports, members and the audit log), the platform admin, and going live.

Activity capture reads mailbox and calendar metadata for the partners and outreach owners who connect their own accounts (BRD 11). It never reads message bodies or attachments. Each user connects from their account menu, under Mailbox and calendar.

## Microsoft 365 (Entra ID app registration)

1. In the Entra admin centre, register an application (single tenant for the client's own staff, or multitenant if Markivis staff in another tenant connect too).
2. Add a web redirect URI: `<APP_URL><APP_BASE_PATH>/api/v1/connections/microsoft/callback`, for example `https://beam.markivis.com/intelligence/api/v1/connections/microsoft/callback`. Sign-in uses its own redirect URI, `<APP_URL><APP_BASE_PATH>/api/auth/callback/microsoft-entra-id`.
3. Under API permissions, add these delegated Microsoft Graph permissions:
   - `User.Read`: the connected mailbox address.
   - `Mail.ReadBasic`: message metadata without body or attachments (least privileged for message delta queries).
   - `Calendars.ReadBasic`: events without body or attachments (least privileged for calendar views).
   - `offline_access`: a refresh token, so sync continues without the user present.
   - `Mail.Send` only when sending from the mailbox is switched on (M9). It is requested separately, on its own consent.
4. Grant admin consent if the tenant requires it.
5. Create a client secret and set `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET` and `AUTH_MICROSOFT_TENANT` (the tenant ID, or `organizations`).

Permission names were checked against the Microsoft Graph reference on 2026-09-30.

## Google Workspace (P1, off by default)

Capture uses `gmail.metadata` (headers only) and `calendar.events.readonly`. Google classes `gmail.metadata` as a restricted scope: an app used by people outside the Google Cloud project's own organisation needs Google's app verification and, for restricted scopes, a security assessment, which takes weeks. The practical route for a client on Google Workspace:

1. The client creates an OAuth client in **their own** Google Cloud project, with the consent screen set to **Internal**. Internal apps are not subject to external verification.
2. Add the redirect URI `<APP_URL><APP_BASE_PATH>/api/v1/connections/google/callback`.
3. Set `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`, and switch on the workspace flag `capture.google`.

## Privacy controls

- Mail and events that involve no tracked person are dropped in memory; nothing about them is stored.
- Each user keeps a private "Never capture" list of addresses and domains.
- The partner can mark a thread or a contact private: those interactions count toward scores, but only partners see their subjects and summaries.
- Disconnecting deletes the stored tokens at once and stops sync. Tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY`.
- If client IT refuses mailbox access, switch off the workspace flags `capture.microsoft` and `capture.google` and log interactions by hand (BRD 25, question 4).

## Sending approved emails

Sending uses the partner's own mailbox and a separate permission, asked for only when the partner chooses "Allow sending" under Mailbox and calendar: `Mail.Send` for Microsoft 365 (add it to the app registration's delegated permissions), `gmail.send` for Google. The daily limit per mailbox is under Settings, Service levels and style guide.

## HubSpot (optional)

1. In HubSpot, create a private app with the scopes `crm.objects.contacts.read`, `crm.objects.contacts.write` and `crm.schemas.contacts.write` (for the two custom properties the sync creates: `dmi_relationship_band` and `dmi_last_two_way_touch`).
2. A platform admin switches on "HubSpot sync" on Settings, Packs.
3. A partner or data steward saves the token on Settings, CRM, and presses Sync now. After that it runs every 15 minutes.
4. When a person is erased here, their HubSpot contact is deleted with HubSpot's GDPR delete, which is permanent. It needs the same contacts write scope. Confirm with the client before switching sync on that this is what they want for erasure requests.

## Data steward

Everything here is on Settings (Consent and suppression, Retention review, Data export, Members and roles, Audit log) or on a person's page, under Consent and privacy.

- **Consent:** record consent per channel and purpose, with the jurisdiction and proof. An opt-in needs proof (where and when it was given). EU, EEA and UK contacts stay blocked from drafting and sending until a lawful basis is recorded.
- **Do not contact:** blocks every draft and send to the person, puts their addresses on the suppression list and dismisses their open actions. Clearing it does not remove an opt-out or an erasure.
- **Suppression list:** holds salted hashes only, so it cannot be read back as addresses. Check an address, or add one for an opt-out that came in by phone or email. Entries from an erasure cannot be removed.
- **Access request:** on the person's page, Export everything held downloads one ZIP with JSON and a CSV per section. The download is written to the audit log.
- **Erasure:** on the person's page, Erase this person. Type their full name to confirm. It deletes the person, any record merged into them and any other record with one of their addresses, with everything about them, removes the personal data from audit entries about them, deletes their HubSpot contact, and puts every address they held on the suppression list. The audit log keeps one entry with counts only. It cannot be undone.
- **Retention review:** people with no current role and no contact for 24 months. Keep takes someone off the list for 12 months; Erase opens their page. You are emailed the count on the first Monday of each month.
- **Workspace export:** Settings, Data export downloads every table as CSV and JSON, with a schema description. Tokens, stored credentials and the suppression salt are left out. With 50,000 people it takes under a minute (see DECISIONS.md, M10).
- **Members and roles:** invite by work email with a role, change a role, remove access. A workspace always keeps one partner, and nobody changes their own membership.
- **Audit log:** filter by what, who, record type and when. Entries cannot be changed or deleted.

## Platform admin

Platform admins are users with `users.is_platform_admin` set (by Markivis, in the database). One with no workspace membership signs in to Platform: every workspace with its members, packs, AI spend and Apollo credits this month, and no workspace data.

To read a workspace for support, open **Break-glass access** on its row: give the reason (for example the ticket number and what you need to check) and how long you need (30 minutes to 2 hours). Access is read-only, a banner shows on every page until it ends, and End access now closes it at once. Opening and ending it are written to that workspace's audit log, and its data stewards are emailed straight away.

Packs and flags are set on Settings, Packs, by a platform admin who is a member of the workspace.

## Going live: the shadow run

Before anyone other than validators sees signals, run all live ingestion for 14 days (BRD 24.1):

1. A platform admin opens Queue, Shadow and presses Start shadow run. New signals are created as shadow signals; only validators and platform admins see them.
2. Validators reject the shadow signals that are wrong, so the report shows each feed's reject share. They cannot confirm them yet.
3. The Shadow tab reports raw items and signals per week by lane and priority, the auto-confirm share, the reject share by feed, and the projected review time a week against the validator's hours (Settings value `validator_hours_per_week`).
4. If the projection is over the validator's time, tighten the noisy feeds (Settings, Sources) and run 7 more days. Record the result in DECISIONS.md.
5. When it fits, press Go live: shadow signals from the last 7 days move into their lanes (auto-confirm ones are confirmed, with their actions), older ones are discarded, and the final report is kept.

## Backups and restore

BRD 19 asks for daily backups kept 30 days, point-in-time recovery where the host supports it, and a restore procedure tested before launch.

- **Primary:** the database host's automated backups, kept 30 days, with point-in-time recovery. They copy storage, so row-level security does not get in their way.
- **Portable copy**, and the method without a managed host: a daily `pg_dump` as `dmi_backup`, a read-only login that bypasses row-level security (created by `db/bootstrap.sql`, granted by migration 0009). The schema owner cannot take a complete dump, because the row-level security is forced even for the owner. Give `dmi_backup` a strong password in production.

```bash
pg_dump "postgres://dmi_backup:<password>@<host>:5432/dmi" --format=custom --schema=dmi --schema=drizzle --file=dmi-$(date +%F).dump
```

Restore into an empty database, on a cluster that has the roles from `db/bootstrap.sql`, as a superuser, so the rows load past row-level security and every object keeps its owner and grants:

```bash
createdb --owner=dmi dmi_restored
psql -d dmi_restored -c "create extension if not exists pg_trgm with schema public"
pg_restore --dbname=dmi_restored --exit-on-error dmi-2026-10-01.dump
DATABASE_MIGRATE_URL=postgres://dmi:<password>@<host>:5432/dmi_restored npm run db:migrate
```

The last step does nothing when the versions match. Then check that the counts of people and audit entries match the source, that `select count(*) from dmi.persons` as `dmi_app` returns 0 (no workspace scope, so row-level security shows nothing), and that you can sign in and open a person. Point `DATABASE_URL` and `DATABASE_MIGRATE_URL` at the restored database to switch over. The job queue (schema `pgboss`) is not in the copy: the worker creates it again on start, and the scheduler restores the schedule.

Tested on 2026-10-01 against the demo database: matching counts, all 39 row-level security policies, the migration journal, and no rows visible without a scope. Repeat the test on the production host before launch (BRD 24.3).
