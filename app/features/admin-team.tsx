"use client";
import { useState } from "react";
import { UsersRound } from "lucide-react";
import { Badge, Feedback, adminPost, formatDateTime, type TeamOverview } from "./admin-shared";

const ROLE_LABEL = {
  owner: "Admin (fest)",
  admin: "Admin",
  moderator: "Moderator",
} as const;

/**
 * Team & Rollen: Admins vergeben und entziehen Admin- und Moderatorrollen.
 * Fest hinterlegte Konten (OPERATOR_ADMIN_IDS) sind nur sichtbar, nicht
 * änderbar.
 */
export function TeamPanel({
  team,
  onChanged,
}: {
  team: TeamOverview;
  onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [owner, setOwner] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">("moderator");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
        <strong>Admin:</strong> alles, auch Regeln, Akquise Days,
        Benachrichtigungen, Discord, CSV-Import und Rollen.{" "}
        <strong>Moderator:</strong> Team-Inbox, Wins-Import, Prüffälle, Pausen
        und Übernahmen, ohne Einstellungen und ohne Kontaktliste.
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
    </section>
  );
}
