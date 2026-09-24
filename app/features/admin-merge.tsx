"use client";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Merge } from "lucide-react";
import { formatDay } from "@/lib/ranking-history";
import { adminPost, Feedback, ProfilePicker, type Participant } from "./admin-shared";

type Summary = {
  id: string;
  name: string;
  company: string;
  hasOwner: boolean;
  importKey: string | null;
  days: number;
  firstDay: string | null;
  lastDay: string | null;
  aliases: number;
  pauses: number;
  drafts: number;
};
type Preview = {
  keep: Summary;
  absorb: Summary;
  owner: "keep" | "absorb" | "none";
  days: {
    day: string;
    action: "move" | "replace" | "drop";
    absorb: { origin: string; attempts: number | null };
    keep: { origin: string; attempts: number | null } | null;
  }[];
};

const fmt = (v: number | null) => (v === null ? "–" : v.toLocaleString("de-DE"));
const originLabel = (o: string) => (o === "closing" ? "eigener Abschluss" : "übernommen");

/**
 * Zwei Profile derselben Person zu einem machen: „Behalten“ ist das Profil
 * mit der Historie, „Auflösen“ das doppelt angelegte. Erst die Vorschau,
 * dann eine Rückfrage, dann passiert es in einem Schritt.
 */
export function MergePanel({
  participants,
  onChanged,
}: {
  participants: Participant[];
  onChanged: () => void;
}) {
  const [keep, setKeep] = useState("");
  const [absorb, setAbsorb] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Jede neue Auswahl setzt Vorschau und Rückfrage zurück; die Vorschau
  // kommt danach vom Server.
  function choose(which: "keep" | "absorb", id: string) {
    setPreview(null);
    setConfirm(false);
    setError("");
    setSuccess("");
    if (which === "keep") setKeep(id);
    else setAbsorb(id);
  }
  useEffect(() => {
    if (!keep || !absorb) return;
    let alive = true;
    adminPost<Preview>("mergePreview", { keep, absorb })
      .then((p) => alive && setPreview(p))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [keep, absorb]);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await adminPost<{ move: number; replace: number; drop: number }>("mergeParticipants", {
        keep,
        absorb,
      });
      setSuccess(
        `Zusammengeführt: ${r.move} Tag(e) übernommen, ${r.replace} ersetzt, ${r.drop} entfallen. Rangliste und Verlauf zeigen jetzt ein Profil.`,
      );
      setKeep("");
      setAbsorb("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const side = (title: string, s: Summary) => (
    <dl className="adm-merge-side">
      <dt>{title}</dt>
      <dd>
        <strong>{s.name}</strong>
        {s.company ? ` · ${s.company}` : ""}
      </dd>
      <dd>{s.hasOwner ? "Konto verknüpft" : "Kein Konto"}</dd>
      <dd>
        {s.days === 0
          ? "Keine Tage"
          : s.days === 1
            ? `1 Tag (${formatDay(s.firstDay!)})`
            : `${s.days} Tage (${formatDay(s.firstDay!, true)} bis ${formatDay(s.lastDay!, true)})`}
      </dd>
      <dd>{s.importKey ? "Aus dem Import bekannt" : "Ohne Import-Schlüssel"}</dd>
      {(s.aliases > 0 || s.pauses > 0 || s.drafts > 0) && (
        <dd>
          {[
            s.aliases ? `${s.aliases} Alias(se)` : "",
            s.pauses ? `${s.pauses} Pause(n)` : "",
            s.drafts ? `${s.drafts} Entwurf/Entwürfe` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </dd>
      )}
    </dl>
  );

  return (
    <section className="adm-card" aria-labelledby="adm-merge-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Merge size={19} />
        </span>
        <div>
          <h2 id="adm-merge-title">Profile zusammenführen</h2>
          <p>
            Wenn sich jemand neu angelegt hat, obwohl sein Profil mit Historie schon da war.
            „Behalten“ ist das Profil mit der Historie, „Auflösen“ das doppelte. Tage,
            Fassungen, Pausen und das Konto wandern zum behaltenen Profil; danach gibt es nur
            noch eines. Das lässt sich nicht rückgängig machen.
          </p>
        </div>
      </div>
      {success && <Feedback success={success} />}
      <div className="adm-merge-pick">
        <ProfilePicker
          participants={participants}
          value={keep}
          onChange={(id) => choose("keep", id)}
          label="Behalten"
        />
        <button
          type="button"
          className="btn secondary adm-merge-swap"
          disabled={!keep && !absorb}
          onClick={() => {
            const k = keep;
            choose("keep", absorb);
            setAbsorb(k);
          }}
          aria-label="Behalten und Auflösen tauschen"
        >
          <ArrowLeftRight size={16} aria-hidden="true" /> Tauschen
        </button>
        <ProfilePicker
          participants={participants}
          value={absorb}
          onChange={(id) => choose("absorb", id)}
          label="Auflösen"
        />
      </div>
      {error && <Feedback error={error} />}
      {preview && (
        <div className="adm-merge-preview">
          <div className="adm-merge-sides">
            {side("Behalten", preview.keep)}
            {side("Auflösen", preview.absorb)}
          </div>
          <p className="adm-hint">
            {preview.owner === "absorb"
              ? "Das Konto hängt am aufzulösenden Profil und wandert zum behaltenen. Die Person meldet sich wie bisher an und sieht danach ihre ganze Historie."
              : preview.owner === "keep"
                ? "Das Konto bleibt am behaltenen Profil."
                : "Keines der Profile hat ein Konto. Eine spätere Übernahme landet beim behaltenen Profil."}
          </p>
          {preview.days.length > 0 && (
            <ul className="adm-merge-days">
              {preview.days.map((d) => (
                <li key={d.day} data-action={d.action}>
                  <span>{formatDay(d.day, true)}</span>
                  <span>
                    {d.action === "move" &&
                      `wird übernommen (${fmt(d.absorb.attempts)} Anwahlen, ${originLabel(d.absorb.origin)})`}
                    {d.action === "replace" &&
                      `eigener Abschluss (${fmt(d.absorb.attempts)} Anwahlen) ersetzt den übernommenen Stand (${fmt(d.keep!.attempts)})`}
                    {d.action === "drop" &&
                      `bleibt beim behaltenen Profil (${fmt(d.keep!.attempts)} Anwahlen); die Meldung mit ${fmt(d.absorb.attempts)} entfällt`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="adm-actions">
            {confirm ? (
              <>
                <span className="adm-merge-question">
                  „{preview.absorb.name}“ wirklich in „{preview.keep.name}“ aufgehen lassen?
                </span>
                <button className="btn primary" disabled={busy} onClick={() => void run()}>
                  Ja, zusammenführen
                </button>
                <button className="btn secondary" disabled={busy} onClick={() => setConfirm(false)}>
                  Abbrechen
                </button>
              </>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => setConfirm(true)}>
                Zusammenführen
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
