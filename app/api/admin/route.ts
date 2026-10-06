import { getCurrentUser, isTeam } from "@/server/auth";
import { database } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import {
  addPause,
  commitmentRules,
  communityRules,
  decidePause,
  deleteEvent,
  listEvents,
  pauseList,
  resolveInbox,
  saveCommitmentRules,
  saveCommunityRules,
  saveEvent,
  teamInbox,
  unconfirmedRegistrations,
} from "@/server/admin";
import { ensureAdminPrefs, notificationStatus } from "@/server/notify";
import {
  commitWins,
  previewWins,
  resolveReviewCase,
  reviewCases,
} from "@/server/wins-import";
import { discordStatus, discordInventory } from "@/server/discord-admin";
import { runDiscordRooms } from "@/server/discord-sessions";
import { designateRole, setTeamRole, teamList } from "@/server/roles";
import { resendConfirmationByTeam } from "@/server/onboarding";
import { mergeParticipants, mergePreview } from "@/server/merge";
import { resendSignupForTeam, signUpForTeam } from "@/server/email-auth";
import { ownMailReady, sendEmailCode } from "@/server/email-code";
import {
  accountlessProfiles,
  confirmRegistrationByTeam,
  createAccessByTeam,
  teamAccessReady,
} from "@/server/team-access";
import { authReady } from "@/server/auth";

export const dynamic = "force-dynamic";

async function admin() {
  const actor = await getCurrentUser();
  if (!actor) throw new AppError("Bitte melde dich mit deiner bestätigten E-Mail an.", 401);
  if (!isTeam(actor))
    throw new AppError("Dieser Bereich ist nur für das Team freigeschaltet.", 403);
  return actor;
}

export async function GET() {
  try {
    const actor = await admin();
    const db = database();
    await ensureAdminPrefs(db, actor);
    const role = actor.admin ? "admin" : "moderator";
    const [inbox, unconfirmed, pauses, events, cases] = await Promise.all([
      teamInbox(db, actor),
      unconfirmedRegistrations(db, actor),
      pauseList(db, actor),
      listEvents(db),
      reviewCases(db, actor),
    ]);
    // Einstellungen, Diagnose und Rollen nur für Admins.
    const adminOnly = actor.admin
      ? await Promise.all([
          commitmentRules(db, actor),
          notificationStatus(db),
          discordStatus(db),
          teamList(db, actor),
          teamAccessReady(db),
        ])
      : null;
    // Zugang anlegen und Freischalten: nur Admins, erst mit Migration 0006.
    const accessReady = !!adminOnly?.[4];
    const access = adminOnly
      ? { ready: accessReady, profiles: accessReady ? await accountlessProfiles(db, actor) : [] }
      : null;
    return json({
      role,
      inbox,
      unconfirmed: { ...unconfirmed, canConfirm: accessReady },
      pauses,
      events,
      cases,
      rules: adminOnly?.[0] ?? null,
      notifications: adminOnly?.[1] ?? null,
      discord: adminOnly?.[2] ?? null,
      team: adminOnly?.[3] ?? null,
      access,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await admin();
    // Der Wins-Import nimmt auch den ganzen Gruppenverlauf an (bis 1 Mio. Zeichen).
    const raw = await body(request, 3_000_000);
    // Zugang und Freischalten brauchen nur ein paar Felder.
    if (["confirmRegistration", "createAccess"].includes(raw?.action) && JSON.stringify(raw).length > 4_000)
      throw new AppError("Die Eingabe ist zu groß.", 413);
    const db = database();
    await rateLimit(db, `admin:${actor.userId}`, 60);
    const v = raw?.value;
    switch (raw?.action) {
      case "resolveInbox":
        return json(await resolveInbox(db, actor, v));
      case "decidePause":
        return json(await decidePause(db, actor, v));
      case "addPause":
        return json(await addPause(db, actor, v));
      case "saveEvent":
        return json(await saveEvent(db, actor, v));
      case "deleteEvent":
        return json(await deleteEvent(db, actor, v));
      case "saveRules":
        return json(await saveCommitmentRules(db, actor, v));
      // Gemeinsames Wochenziel: Stand lesen und Teamwert speichern (leer = automatisch).
      case "communityRules":
        return json(await communityRules(db, actor));
      case "saveCommunityRules":
        return json(await saveCommunityRules(db, actor, v));
      case "previewWins":
        return json(await previewWins(db, actor, v));
      case "commitWins":
        return json(await commitWins(db, actor, v));
      case "resolveCase":
        return json(await resolveReviewCase(db, actor, v));
      case "mergePreview":
        return json(await mergePreview(db, actor, v));
      case "mergeParticipants":
        return json(await mergeParticipants(db, actor, v));
      case "discordRooms":
        if (!actor.admin) throw new AppError("Nur für Admins.", 403);
        return json(await runDiscordRooms(db));
      case "discordInventory":
        if (!actor.admin) throw new AppError("Das kann nur ein Admin.", 403);
        return json(await discordInventory());
      case "setRole":
        return json(await setTeamRole(db, actor, v));
      case "designateRole":
        return json(await designateRole(db, actor, v));
      case "resendConfirmation":
        if (!authReady()) throw new AppError("Die Anmeldung ist noch nicht eingerichtet.", 503);
        // Eigene Mail (Code und Link auf unserer Domain), sonst die von Supabase.
        return json(
          await resendConfirmationByTeam(db, actor, v, async (email, request) => {
            if (await ownMailReady(db)) {
              try {
                await sendEmailCode(db, { email, purpose: "confirm", request });
                return;
              } catch {
                /* weiter mit der Mail von Supabase */
              }
            }
            await resendSignupForTeam(email, request);
          }),
        );
      case "confirmRegistration":
        return json(await confirmRegistrationByTeam(db, actor, v));
      case "createAccess":
        if (!authReady()) throw new AppError("Die Anmeldung ist noch nicht eingerichtet.", 503);
        return json(await createAccessByTeam(db, actor, v, signUpForTeam));
      default:
        throw new AppError("Unbekannte Aktion.");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
