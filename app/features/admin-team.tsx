"use client";
import { useState } from "react";
import { UsersRound } from "lucide-react";
import {
  Badge,
  Feedback,
  ProfilePicker,
  adminPost,
  formatDateTime,
  type Participant,
  type TeamOverview,
} from "./admin-shared";

const ROLE_LABEL = {
  owner: "Admin (fest)",
  admin: "Admin",
  moderator: "Moderator",
} as const;

/**
 * Team & Rollen: Admins vergeben und entziehen Admin- und Moderatorrollen.
 * Fest hinterlegte Konten (OPERATOR_ADMIN_IDS) sind nur sichtbar, nicht
 * änderbar. Für Profile ohne Konto lässt sich eine Rolle vormerken; sie gilt
 * nach der freigegebenen Übernahme des Profils.
 */
export function TeamPanel({
  team,
  participants,
  onChanged,
}: {
  team: TeamOverview;
  participants: Participant[];
  onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [owner, setOwner] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">("moderator");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profileId, setProfileId] = useState("");
  const [profileRole, setProfileRole] = useState<"admin" | "moderator">("moderator");
  // Nur freie, persönliche Profile; gemeinsame Meldungen blendet der Picker aus.
  const freeProfiles = participants.filter((p) => !p.claimed && p.kind === "person");

  const needle = filter.trim().toLocaleLowerCase("de");
  const shown = team.accounts.filter(
    (a) =>
      a.owner === owner ||
      !needle ||
      `${a.name ?? ""} ${a.email}`.toLocaleLowerCase("de").includes(needle),
  );
  const label = (m: { name: string | null; email: string | null }) =>
    m.name ? `${m.name}${m.email ? ` · ${m.email}` : ""}` : m.email || "Konto ohne Adresse";

  async function save(target: string, next: "admin" | "moderator" | null, done: string) {
    setBusy(target);
    setError("");
    setSuccess("");
    try {
      await adminPost("setRole", { owner: target, role: next });
      setSuccess(done);
      setConfirmRemove(null);
      if (target === owner) setOwner("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function designate(
    participantId: string,
    next: "admin" | "moderator" | null,
    done: string,
  ) {
    setBusy(`profil:${participantId}`);
    setError("");
    setSuccess("");
    try {
      await adminPost("designateRole", { participantId, role: next });
      setSuccess(done);
      if (participantId === profileId) setProfileId("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="adm-card" aria-labelledby="adm-team-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <UsersRound size={19} />
        </span>
        <div>
          <h2 id="adm-team-title">Team & Rollen</h2>
          <p>
            Admins und Moderatoren bekommen bei jeder neuen Anmeldung und jeder
            Profilübernahme einen Push-Hinweis, sobald sie auf ihrem Gerät
            unter Tagesabschluss → Benachrichtigungen Pushs erlaubt haben.
            Zusätzlich geht eine kurze E-Mail an die bestätigte Adresse, sobald
            der E-Mail-Versand eingerichtet ist. Jede Person kann beides dort
            selbst abschalten.
          </p>
        </div>
      </div>
      <p className="adm-hint">
        <strong>Moderator:</strong> Team-Inbox, Wins-Import, Prüffälle, Pausen,
        Übernahmen prüfen und Team-Pushs, dazu Sessions aller Mitglieder
        bearbeiten und absagen sowie im Discord die Moderatorrolle (für
        verknüpfte Discord-Konten). Keine Einstellungen, keine Kontaktliste.{" "}
        <strong>Admin:</strong> alles davon und zusätzlich Regeln,
        Benachrichtigungen, Discord-Einrichtung, CSV-Import, Akquise Days und
        Rollen.
      </p>

      <Feedback error={error} success={success} />

      <h3 className="adm-subhead">Aktuelles Team</h3>
      <ul className="adm-list">
        {team.members.map((m) => (
          <li key={m.owner} className="adm-item adm-compact">
            <div className="adm-item-head">
              <Badge tone={m.role === "moderator" ? "neutral" : "ok"}>
                {ROLE_LABEL[m.role]}
              </Badge>
              <span className="adm-meta">
                {m.fixed
                  ? "Fest in der Serverumgebung hinterlegt"
                  : m.grantedAt
                    ? `Seit ${formatDateTime(m.grantedAt)}`
                    : ""}
              </span>
            </div>
            <h3>{label(m)}</h3>
            {!m.fixed && (
              <div className="adm-actions">
                {m.role === "moderator" ? (
                  <button
                    className="btn secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void save(m.owner, "admin", `${label(m)} ist jetzt Admin.`)
                    }
                  >
                    Zum Admin machen
                  </button>
                ) : (
                  <button
                    className="btn secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void save(m.owner, "moderator", `${label(m)} ist jetzt Moderator.`)
                    }
                  >
                    Zum Moderator machen
                  </button>
                )}
                {confirmRemove === m.owner ? (
                  <>
                    <button
                      className="btn primary"
                      disabled={!!busy}
                      onClick={() =>
                        void save(m.owner, null, `${label(m)} hat keine Team-Rolle mehr.`)
                      }
                    >
                      Ja, Rolle entfernen
                    </button>
                    <button
                      className="btn secondary"
                      disabled={!!busy}
                      onClick={() => setConfirmRemove(null)}
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    className="btn secondary"
                    disabled={!!busy}
                    onClick={() => setConfirmRemove(m.owner)}
                  >
                    Rolle entfernen
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <h3 className="adm-subhead">Rolle vergeben</h3>
      {team.accounts.length === 0 ? (
        <p className="adm-empty">
          Es gibt noch kein weiteres bestätigtes Konto. Wer eine Rolle bekommen
          soll, meldet sich zuerst einmal mit seiner E-Mail an.
        </p>
      ) : (
        <form
          className="adm-form"
          onSubmit={(e) => {
            e.preventDefault();
            const picked = team.accounts.find((a) => a.owner === owner);
            if (!picked) {
              setError("Bitte wähle zuerst ein Konto aus.");
              return;
            }
            void save(
              owner,
              role,
              `${label(picked)} ist jetzt ${role === "admin" ? "Admin" : "Moderator"}.`,
            );
          }}
        >
          <div className="adm-picker">
            <label htmlFor="adm-team-filter">Konto suchen</label>
            <input
              id="adm-team-filter"
              type="search"
              placeholder="Name oder E-Mail"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <label htmlFor="adm-team-account" className="sr-only">
              Konto
            </label>
            <select
              id="adm-team-account"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Konto auswählen …</option>
              {shown.map((a) => (
                <option key={a.owner} value={a.owner}>
                  {label(a)}
                </option>
              ))}
            </select>
          </div>
          <label className="adm-field adm-field-narrow">
            <span>Rolle</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "moderator")}
            >
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="adm-actions">
            <button type="submit" className="btn primary" disabled={!!busy || !owner}>
              Rolle vergeben
            </button>
          </div>
          <p className="adm-hint">
            Die Auswahl zeigt Konten, die sich schon einmal mit bestätigter
            E-Mail angemeldet haben.
          </p>
        </form>
      )}

      <h3 className="adm-subhead">Rolle für ein Profil vormerken</h3>
      <p className="adm-hint">
        Für Personen mit Profil aus der Rangliste, die noch kein Konto haben. Die
        Rolle gilt, sobald das Team die Übernahme dieses Profils freigegeben
        hat.
      </p>
      {team.designations.length > 0 && (
        <ul className="adm-list">
          {team.designations.map((d) => {
            const name = d.name
              ? `${d.name}${d.company ? ` · ${d.company}` : ""}`
              : "Profil nicht mehr vorhanden";
            return (
              <li key={d.participantId} className="adm-item adm-compact">
                <div className="adm-item-head">
                  <Badge tone={d.available ? "action" : "warn"}>
                    {d.available
                      ? `Wird ${ROLE_LABEL[d.role]}`
                      : "Profil nicht mehr übernehmbar"}
                  </Badge>
                  <span className="adm-meta">
                    Vorgemerkt am {formatDateTime(d.designatedAt)} von{" "}
                    {d.designatedBy}
                  </span>
                </div>
                <h3>{name}</h3>
                <div className="adm-actions">
                  <button
                    className="btn secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void designate(
                        d.participantId,
                        null,
                        `Vormerkung für ${d.name ?? "das Profil"} entfernt.`,
                      )
                    }
                  >
                    Entfernen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {freeProfiles.length === 0 ? (
        <p className="adm-empty">
          Gerade gibt es kein freies Profil einer einzelnen Person.
        </p>
      ) : (
        <form
          className="adm-form"
          onSubmit={(e) => {
            e.preventDefault();
            const picked = freeProfiles.find((p) => p.id === profileId);
            if (!picked) {
              setError("Bitte wähle zuerst ein Profil aus.");
              return;
            }
            void designate(
              picked.id,
              profileRole,
              `${picked.name} wird nach der Freigabe der Übernahme ${ROLE_LABEL[profileRole]}.`,
            );
          }}
        >
          <ProfilePicker
            participants={freeProfiles}
            value={profileId}
            onChange={setProfileId}
            label="Profil ohne Konto"
          />
          <label className="adm-field adm-field-narrow">
            <span>Rolle</span>
            <select
              value={profileRole}
              onChange={(e) =>
                setProfileRole(e.target.value as "admin" | "moderator")
              }
            >
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="adm-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={!!busy || !profileId}
            >
              Vormerken
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
