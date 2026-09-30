# Admin guide: mailbox and calendar capture

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
