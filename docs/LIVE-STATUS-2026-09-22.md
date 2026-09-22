# Live status — 22 September 2026

Production: https://dealoperator.hk-growthoperator.de

## Infrastructure

- Coolify application `dealoperator`, branch `main`, Dockerfile deployment.
- Supabase project `xfusnmbwymfkuuadyrlw`, organisation Deal Operator.
- Runtime configuration now includes `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, and `DATABASE_SSL_CA`.
- Database uses the restricted `operator_app` role and the Supabase session pooler on port 5432. TLS certificate verification remains enabled. The project CA is supplied through `DATABASE_SSL_CA`; escaped newlines are intentional.
- `/api/ready` returns HTTP 200 with configuration and database ready. `/api/ranking` returns `ready:true`, `snapshot:false`.
- Production database credentials are not available to builds or preview deployments. Do not replace the runtime role with the database owner or disable certificate verification.
- Resend SMTP delivers the authentication mail. Both email templates use `deploy/auth-email.html`. The owner's email is confirmed in Supabase. The current PKCE login flow requires opening the link in the browser that requested it.
- Owner explicitly approved team administration. `OPERATOR_ADMIN_IDS` is configured in Coolify production and takes effect with the next deployment. It is disabled in previews.

## Imported data

The earlier 23-profile snapshot has been superseded by the real database import. Do not restore or re-import the old snapshot over these records.

All 51 public profiles and all eight metric fields were checked against the deduplicated source plan through the live public API. Sources: full Slack transcript through 18:26 and the Zoom group-chat export captured at 18:19. Private messages and contacts were excluded.

| Metric | Confirmed imported total |
| --- | ---: |
| Profiles (49 individual, 2 joint team profiles) | 51 |
| Attempts | 5,127 |
| Decision-maker conversations | 25 |
| Settings booked | 97 |
| Settings held | 3 |
| Closings booked | 4 |
| Closings held | 1 |
| Deals won | 1 |
| Meetings without a reported type | 38 |

Import rules:

- Latest cumulative reports replace earlier metric/day counts; they are not added together.
- Existing participant keys remain stable across confirmed aliases and renamed profiles.
- User confirmed Marc Höppner/Marc, Paul/Paul Strzelczyk, ROB/Robert Marzecki, Jonathan/Jonathan Balzer, Gagan Singh/Gagan, and previously Mel/Melanie Sorokin.
- Joint reports for Myran und Baris and David & Jannik count once. Their contained individual results are not added again or arbitrarily split.
- Generic appointments are not silently converted into settings. Known classifications for Luca and Leopold replace the corresponding generic metric, avoiding duplicate counts.
- Selina's three callbacks were excluded from her reported ten settings, leaving seven booked meetings. Two held settings are explicitly reported.
- Carina's third final appointment remains unresolved: two clearly booked settings were imported; the earlier promised booking/callback was not counted as a confirmed appointment.
- Unknown stays `null`, explicit zero stays `0`; no half-settings, goals, approximate thresholds, reactions, or quoted third-party totals are added.
- Updates used guarded transactions, preserved revision history, and queued the existing sync outbox. A queued event does not mean a Discord bot has delivered it.

## Ranking change

All eight stored metrics are now available in the public ranking and group totals, including held appointments and meetings without a type. Profile details follow refreshed rows. Returning to a visible tab fetches current data immediately; regular visible-tab refresh remains every 20 seconds.

New website reports follow the existing authenticated ownership and publication-consent rules. Slack/Zoom imports are currently curated imports; ongoing automatic chat ingestion and the Discord bot still require their separate integration. No end-to-end Discord delivery is claimed.

Validation: 41 existing tests passed, TypeScript and lint passed, production build passed, new metric tab inspected in the browser. Full live claim approval with two independent accounts remains to be exercised.
