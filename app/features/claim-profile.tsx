"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
export default function ClaimProfile({
  signedIn,
  profileId,
}: {
  signedIn: boolean;
  profileId: string;
}) {
  const [id, setId] = useState(profileId === "beispiel" ? "" : profileId);
  const [token, setToken] = useState("");
  const [candidates, setCandidates] = useState<
    { id: string; name: string; company: string }[]
  >([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  useEffect(() => {
    if (!signedIn) return;
    const c = new AbortController();
    fetch("/api/operator", { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setCandidates(d.candidates);
        if (d.candidates.length === 1 && !profileId) setId(d.candidates[0].id);
        if (d.participant)
          setMessage(
            `Du hast bereits das Profil „${d.participant.name}“. Für eine Zusammenführung hilft dir die Verwaltung.`,
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setMessage(e.message);
      });
    return () => c.abort();
  }, [signedIn, profileId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claim",
          value: { participantId: id, ...(token ? { token } : {}) },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDone(d.name);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card card">
      <span className="icon-tile lime">
        {done ? <Check /> : <ShieldCheck />}
      </span>
      <h1>
        {done ? `Willkommen, ${done}.` : "Deine Zahlen.\nJetzt dein Profil."}
      </h1>
      <p>
        {done
          ? "Dein Profil ist mit deinem Konto verbunden. Deine bisherigen Zahlen und dein Fortschritt sind übernommen."
          : "Du hast schon Zahlen in der Gruppe eingereicht? Übernimm dein vorbereitetes Profil und mach mit deinem bisherigen Stand weiter."}
      </p>
      {profileId === "beispiel" && (
        <div className="notice">
          Du kommst aus einem fiktiven Beispielprofil. Das lässt sich nicht als
          echtes Mitgliedskonto übernehmen.
        </div>
      )}
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      {done ? (
        <Link className="btn primary" href="/zahlen?modus=eigen">
          Zu meinen Zahlen
        </Link>
      ) : !signedIn ? (
        <>
          <ol className="claim-steps">
            <li>
              Mit deiner E-Mail anmelden und den Link im Postfach bestätigen.
            </li>
            <li>
              Passendes Profil wählen oder deinen persönlichen Einmalcode
              eingeben.
            </li>
            <li>Bisherige Zahlen übernehmen und gemeinsam weitermachen.</li>
          </ol>
          <Link
            className="btn primary full"
            href={`/beitreten?next=${encodeURIComponent("/profil-uebernehmen" + (id ? "?profil=" + id : ""))}`}
          >
            Kostenfrei anmelden
          </Link>
        </>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          {candidates.length > 0 ? (
            <label>
              Passendes vorbereitetes Profil
              <select
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
              >
                <option value="">Profil auswählen</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.company ? `· ${p.company}` : ""}
                  </option>
                ))}
              </select>
              <small>Diese Profile passen zu deiner bestätigten E-Mail.</small>
            </label>
          ) : (
            <label>
              Profilkennung
              <input
                value={id}
                onChange={(e) => setId(e.target.value.trim())}
                required
                placeholder="Aus deiner persönlichen Einladung"
              />
              <small>
                Wenn du dein Profil aus dem Ranking öffnest, ist die Kennung
                bereits eingetragen.
              </small>
            </label>
          )}
          <label>
            Persönlicher Einmalcode {candidates.length > 0 ? "(optional)" : ""}
            <input
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              autoComplete="off"
              placeholder="Code aus deiner Einladung"
              required={!candidates.some((c) => c.id === id)}
            />
            <small>
              Ist keine passende E-Mail hinterlegt, erhältst du deinen Code von
              der Community-Verwaltung.
            </small>
          </label>
          <button className="btn primary full" disabled={busy}>
            {busy
              ? "Zuordnung wird geprüft …"
              : "Profil & bisherige Zahlen übernehmen"}
          </button>
        </form>
      )}
      <div className="auth-note">
        <ShieldCheck size={20} />
        <span>
          Die bestätigte E-Mail oder dein gültiger persönlicher Code schützt
          dein Profil vor einer fremden Übernahme.
        </span>
      </div>
    </section>
  );
}
