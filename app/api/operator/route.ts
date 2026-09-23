import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
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
  updateAccount,
} from "@/server/operator";
import { decideRequest, reviewQueue } from "@/server/onboarding";
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
      ...(actor.admin
        ? {
            contacts: await adminContacts(db, actor),
            requests: await reviewQueue(db, actor),
            participants: await db.query(
              "SELECT id,import_key,name,company,kind,owner IS NOT NULL AS claimed,public_consent,searchable FROM participants ORDER BY created_at DESC",
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
    if (!actor.admin)
      throw new AppError(
        "Dieser Bereich ist nur für die Verwaltung freigeschaltet.",
        403,
      );
    if (value.action === "previewImport") {
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
