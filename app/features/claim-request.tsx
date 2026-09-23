"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search, Send, ShieldCheck } from "lucide-react";

type Profile = { id: string; name: string; company: string; role: string };
type Step = "search" | "confirm" | "details";

/**
 * Übernahme mit einem angemeldeten Konto: Profil suchen (oder aus Link bzw.
 * Einladung übernehmen), Angaben für den Abgleich ergänzen, Anfrage senden.
 * Die E-Mail ist bereits bestätigt, deshalb gibt es keinen zweiten Link.
 */
export default function ClaimRequest({
  email,
  phone,
  preselected,
  invite,
  problem,
}: {
  email: string;
  phone: string;
  preselected: Profile | null;
  invite: string;
  problem: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(preselected ? "confirm" : "search");
  const [selected, setSelected] = useState<Profile | null>(preselected);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [value, setValue] = useState({ fullName: "", phone, hint: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(problem);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`/api/onboarding?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setResults(d.profiles || []);
      setSearched(true);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "search") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(query), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, step, runSearch]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claim",
          value: {
            participantId: selected.id,
            ...(invite && selected.id === preselected?.id ? { invite } : {}),
            ...value,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      router.replace("/status");
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="auth-card card">
      <span className="icon-tile lime">
        {step === "search" ? <Search /> : <ShieldCheck />}
      </span>
      <h1>Deine Zahlen übernehmen.</h1>
      <p>
        {step === "search"
          ? "Such das Profil, unter dem deine Zahlen schon im Ranking stehen."
          : "Das Team prüft deine Anfrage und gibt das Profil danach frei."}
      </p>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}

      {step === "search" && (
        <>
          <div className="form-stack">
            <label>
              Dein Name
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Vorname oder Nachname eingeben"
                aria-label="Profil suchen"
              />
              <small>
                Wir zeigen nur Profile, die noch niemand übernommen hat.
                Kontaktdaten sind hier nicht sichtbar.
              </small>
            </label>
          </div>
          {searching && (
            <p className="onboarding-hint">
              <LoaderCircle className="spin" size={16} /> Suche läuft …
            </p>
          )}
          {!searching && searched && results.length === 0 && (
            <div className="notice">
              <strong>Kein passendes Profil gefunden.</strong>
              <p>
                Versuche eine andere Schreibweise. Ist dein Profil nur über eine
                persönliche Einladung erreichbar, öffne bitte den Link aus der
                Einladung.
              </p>
            </div>
          )}
          {results.length > 0 && (
            <div className="onboarding-candidates">
              {results.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setSelected(p);
                    setMessage("");
                    setStep("confirm");
                  }}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {[p.company, p.role].filter(Boolean).join(" · ") || "Caller"}
                  </small>
                </button>
              ))}
            </div>
          )}
          <Link className="btn secondary full" href="/start">
            Stattdessen eigenes Profil anlegen
          </Link>
        </>
      )}

      {step === "confirm" && selected && (
        <>
          <div className="onboarding-selected">
            <span>Du möchtest das Profil von</span>
            <strong>{selected.name}</strong>
            {[selected.company, selected.role].filter(Boolean).length > 0 && (
              <small>{[selected.company, selected.role].filter(Boolean).join(" · ")}</small>
            )}
            <span>übernehmen.</span>
          </div>
          <div className="notice">
            <strong>Das Team prüft deine Übernahme.</strong>
            <p>
              Deine bestätigte E-Mail reicht dafür nicht aus, auch eine
              Einladung nicht. Das Deal-Operator-Team gleicht deine Angaben mit
              der bekannten Person ab und gibt das Profil anschließend frei.
            </p>
          </div>
          <button className="btn primary full" onClick={() => setStep("details")}>
            Weiter zu meinen Angaben
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setSelected(null);
              setMessage("");
              setStep("search");
            }}
          >
            Anderes Profil suchen
          </button>
        </>
      )}

      {step === "details" && selected && (
        <form className="form-stack" onSubmit={submit}>
          <div className="onboarding-selected compact">
            <span>Ausgewähltes Profil</span>
            <strong>{selected.name}</strong>
            <button type="button" className="text-link" onClick={() => setStep("confirm")}>
              Auswahl ändern
            </button>
          </div>
          <p className="onboarding-hint">
            Bestätigte E-Mail: <strong>{email}</strong>
          </p>
          <label>
            Vor- und Nachname
            <input
              required
              autoComplete="name"
              minLength={3}
              maxLength={120}
              value={value.fullName}
              onChange={(e) => setValue({ ...value, fullName: e.target.value })}
              placeholder="Wie du wirklich heißt"
            />
            <small>
              Dein echter Name hilft dem Team beim Abgleich. Öffentlich bleibt
              der Anzeigename des Profils.
            </small>
          </label>
          <label>
            Telefon mit Ländervorwahl
            <input
              type="tel"
              required
              autoComplete="tel"
              maxLength={40}
              value={value.phone}
              onChange={(e) => setValue({ ...value, phone: e.target.value })}
              placeholder="+49 170 1234567"
            />
            <small>
              Bleibt privat, erscheint nie im Ranking und wird nicht per SMS
              geprüft.
            </small>
          </label>
          <label>
            Zuordnungshilfe (optional)
            <input
              maxLength={300}
              value={value.hint}
              onChange={(e) => setValue({ ...value, hint: e.target.value })}
              placeholder="Zum Beispiel dein Name im Gruppenchat"
            />
          </label>
          <button className="btn primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <Send size={18} />}
            Übernahme anfragen
          </button>
        </form>
      )}

      <div className="auth-note">
        <ShieldCheck size={20} />
        <span>
          Deine Kontaktdaten sehen nur du und das Deal-Operator-Team. Sie stehen
          nie im öffentlichen Ranking.
        </span>
      </div>
    </section>
  );
}
