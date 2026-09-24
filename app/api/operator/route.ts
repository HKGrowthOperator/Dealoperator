import { z } from "zod";
import { getCurrentUser, isTeam } from "@/server/auth";
import { database } from "@/server/database";
import {
  AppError,
  adminContacts,
  commitImport,
  createMember,
  issueClaim,
  ownState,
  previewImport,
  rateLimit,
  setSearchable,
  showInRanking,
  updateAccount,
} from "@/server/operator";
import { decideRequest, reviewQueue } from "@/server/onboarding";
import { DESIGNATIONS_KEY } from "@/server/roles";
import { parseImport } from "@/lib/kpis";
import { body, errorResponse, json } from "@/server/http";
export async function GET() {
  try {
    const actor = await getCurrentUser();
    if (!actor)
      return json(
        { error: "Bitte melde dich mit deiner bestätigten E-Mail an." },
        401,
      );
    const db = database();
    const state = await ownState(db, actor);
    return json({
      ...state,
      ...(isTeam(actor)
        ? {
            // Die vollständige Kontaktliste sehen nur Admins; Moderatoren
            // bekommen Kontaktdaten nur an der einzelnen Anfrage.
            contacts: actor.admin ? await adminContacts(db, actor) : [],
            requests: await reviewQueue(db, actor),
            // designated_role: für das Profil vorgemerkte Team-Rolle (siehe
            // designateRole), damit die Übernahmeprüfung darauf hinweist.
            participants: await db.query(
              `SELECT p.id,p.import_key,p.name,p.company,p.kind,p.owner IS NOT NULL AS claimed,
                      p.public_consent,p.searchable,
                      (SELECT s.value->p.id->>'role' FROM app_settings s
                        WHERE s.key=$1 AND jsonb_typeof(s.value)='object') AS designated_role
                 FROM participants p ORDER BY p.created_at DESC`,
              [DESIGNATIONS_KEY],
            ),
          }
        : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor)
      return json(
        { error: "Bitte melde dich mit deiner bestätigten E-Mail an." },
        401,
      );
    const value = await body(request);
    const db = database();
    await rateLimit(db, actor.userId, 30);
    if (value.action === "onboard")
      return json(await createMember(db, actor, value.value));
    if (value.action === "checkin")
      throw new AppError(
        "Tageszahlen gehen jetzt über den Tagesabschluss mit kurzer Reflexion.",
        410,
      );
    if (value.action === "account")
      return json(await updateAccount(db, actor, value.value));
    if (value.action === "showInRanking") return json(await showInRanking(db, actor));
    if (!isTeam(actor))
      throw new AppError(
        "Dieser Bereich ist nur für das Team freigeschaltet.",
        403,
      );
    if (value.action === "previewImport") {
      // Wie der CSV-Import selbst nur für Admins.
      if (!actor.admin)
        throw new AppError("Den CSV-Import nutzt nur ein Admin.", 403);
      const rows = parseImport(z.string().max(250000).parse(value.text));
      return json({ rows, preview: await previewImport(db, rows) });
    }
    if (value.action === "commitImport")
      return json(await commitImport(db, actor, value.value));
    if (value.action === "decideRequest")
      return json(await decideRequest(db, actor, value.value));
    if (value.action === "setSearchable")
      return json(await setSearchable(db, actor, value.value));
    if (value.action === "issueClaim")
      return json(
        await issueClaim(db, actor, z.string().max(100).parse(value.id)),
      );
    throw new AppError("Unbekannte Aktion.");
  } catch (e) {
    return errorResponse(e);
  }
}
