"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { CircleAlert, CircleCheck, Link2, LoaderCircle, Unlink } from "lucide-react";
import { DISCORD_INVITE } from "@/lib/discord";
import { getJson, postJson } from "./closing-form";
import "../commitment.css";

/*
 * Discord-Konto mit dem Website-Konto verknüpfen. Solange der Server die
 * Verknüpfung nicht anbietet (available=false), steht hier ehrlich „noch
 * nicht eingerichtet“ und kein Knopf, der nur so tut.
 */

type LinkState = { available: boolean; link: { name: string; since: string } | null };

const RESULT: Record<string, { tone: "ok" | "warn" | "error"; text: string }> = {
  verbunden: { tone: "ok", text: "Dein Discord-Konto ist jetzt verknüpft." },
  vergeben: {
    tone: "warn",
    text: "Dieses Discord-Konto ist schon mit einem anderen Profil verknüpft. Es wurde nichts geändert.",
  },
  abgebrochen: {
    tone: "warn",
    text: "Die Verknüpfung wurde abgebrochen. Es wurde nichts geändert.",
  },
  anmelden: {
    tone: "warn",
    text: "Bitte melde dich an und starte die Verknüpfung danach noch einmal.",
  },
  fehler: {
    tone: "error",
    text: "Die Verknüpfung hat nicht geklappt. Bitte versuche es später noch einmal.",
  },
};

const sinceText = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));

export default function DiscordLink({
  initial,
  result,
}: {
  initial?: LinkState | null;
  /** Rückmeldung aus ?discord=… nach der Rückkehr von Discord. */
  result?: string;
}) {
  const uid = useId();
  const [state, setState] = useState<LinkState | null>(initial ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState(result && RESULT[result] ? RESULT[result] : null);

  const load = useCallback(async () => {
    try {
      setState(await getJson<LinkState>("/api/discord/connect"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    getJson<LinkState>("/api/discord/connect")
      .then((fresh) => alive && setState(fresh))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [initial]);

  // Solange die Verknüpfung nicht angeboten wird, gibt es hier nichts zu tun.
  const hidden = !!state && !state.available && !state.link && !notice && !error;

  async function start() {
    setBusy(true);
    setNotice(null);
    setError("");
    try {
      const { url } = await postJson<{ url: string }>("/api/discord/connect", { action: "start" });
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function unlink() {
    setBusy(true);
    setNotice(null);
    setError("");
    try {
      await postJson("/api/discord/connect", { action: "unlink" });
      setConfirm(false);
      await load();
      setNotice({ tone: "ok", text: "Die Verknüpfung ist aufgehoben." });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;
  return (
    <section id="discord" className="cm-card cm-discord" aria-labelledby={`${uid}-title`}>
      <header className="cm-section-head">
        <div>
          <h2 id={`${uid}-title`}>Discord-Konto verknüpfen</h2>
        </div>
        <p className="cm-muted">
          Damit bekommst du im Discord automatisch deine Ränge, zum Beispiel „Aktiver Caller“,
          und kommst in die Session-Räume. Deine Kontaktdaten gehen dabei nicht an Discord.
        </p>
      </header>

      {notice && (
        <p className={`cm-alert ${notice.tone}`} role="status">
          {notice.tone === "ok" ? (
            <CircleCheck size={18} aria-hidden="true" />
          ) : (
            <CircleAlert size={18} aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </p>
      )}
      {error && (
        <p className="cm-alert error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {!state ? (
        !error && (
          <p className="cm-loading">
            <LoaderCircle className="spin" size={18} aria-hidden="true" /> Stand wird geladen …
          </p>
        )
      ) : state.link ? (
        <div className="cm-linked">
          <div>
            <strong>Verknüpft mit {state.link.name}</strong>
            <small>Seit {sinceText(state.link.since)}</small>
          </div>
          {confirm ? (
            <span className="cm-discard-confirm">
              <span>Verknüpfung wirklich trennen?</span>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void unlink()}
              >
                Ja, trennen
              </button>
              <button type="button" className="btn secondary" onClick={() => setConfirm(false)}>
                Abbrechen
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              <Unlink size={16} aria-hidden="true" /> Trennen
            </button>
          )}
        </div>
      ) : state.available ? (
        <div className="cm-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <Link2 size={16} aria-hidden="true" />
            )}
            Mit Discord verknüpfen
          </button>
        </div>
      ) : (
        <div className="cm-device-state info">
          <Link2 size={20} aria-hidden="true" />
          <div>
            <strong>Noch nicht eingerichtet</strong>
            <p>
              Die Verknüpfung mit Discord ist auf der Website noch nicht eingerichtet. Den Server
              erreichst du trotzdem schon über den{" "}
              <a className="cm-link" href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
                Einladungslink
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
