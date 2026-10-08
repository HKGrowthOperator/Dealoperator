# Prepared member directory

Prepared profiles are application records, not Supabase Auth users. Importing this directory must not send mail, invitations, push notifications or enqueue sync jobs.

Store source contacts only in the private `operator` schema. The registry is `operator.app_settings`, key `akquise_member_directory`, a JSON object keyed by a stable source member ID or contact fingerprint. Each value contains `participantId`, `name`, `displayName`, `email`, `phone`, `source` and capture date. Never commit real contact exports to this repository.

For a new member, create a person in `participants` with `owner = NULL`, `searchable = false`, `public_consent = false` and no check-ins. Reuse the existing participant ID for a known member; never replace ownership, visibility, check-ins or an existing verified contact. Exclude Account Managers and members with an `@akquise.de` address. Missing contacts remain empty.

The public ranking already requires recorded check-ins. Prepared profiles without numbers remain absent from ranking and public profile selection. Their source phone is visible only through the admin contact endpoint, separately from the number supplied by an authenticated account.

Registration first verifies the email through Supabase. Only authenticated server code reads the exact email match from the private registry. A unique match with no reports or owner reuses the prepared participant ID. A profile with historical reports becomes a claim request for team approval. Multiple profiles sharing an email block automatic assignment. Existing ownership is never replaced. Ordinary logins remain unchanged.

Repeated imports must use the same source member ID/contact fingerprint, reuse its participant mapping and update source contacts without creating extra profiles. Matching solely by a first name is insufficient when more than one source member shares it. Keep an import audit and verify that existing owners, check-ins and notification queues remain unchanged.
