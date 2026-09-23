"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  LoaderCircle,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

type Profile = { id: string; name: string; company: string; role: string };
type Step = "choice" | "search" | "confirm" | "contact" | "sent";

const EMPTY = { fullName: "", email: "", phone: "", hint: "" };

// Gemeinsame Teamprofile tragen ihre Kennzeichnung in der Rolle. Bei einer
// Übernahme muss sichtbar bleiben, dass es sich um ein gemeinsames Ergebnis
// handelt und nicht um die Einzelleistung einer Person.
const isTeam = (p: Profile | null) => /^team\b/i.test(p?.role || "");

// Der Rücksprung aus der Mail kann aus vier Gründen scheitern. Eine
// Sammelmeldung „abgelaufen oder bereits verwendet" beschreibt den häufigsten
// Fall — Link in einem anderen Browser geöffnet — schlicht falsch.
const LINK_ERROR: Record<string, string> = {
  browser:
    "Dieser Link gehört zu dem Browser, in dem du ihn angefordert hast. In einem anderen Browser lässt er sich aus Sicherheitsgründen nicht öffnen. Fordere hier einfach einen neuen Link an und öffne ihn dann in genau diesem Browser.",
  abgelaufen:
    "Dieser Bestätigungslink ist abgelaufen. Fordere einen neuen an — deine Angaben sind gespeichert.",
  verwendet:
    "Dieser Bestätigungslink wurde bereits verwendet. Fordere einen neuen an, wenn du dich erneut anmelden möchtest.",
  link: "Dieser Bestätigungslink ist unvollständig. Fordere sicherheitshalber einen neuen an.",
};

export default function OnboardingStart({
  ready,
  preselected,
  invite,
  linkError,
  problem = "",
  needsInvite = "",
}: {
  ready: boolean;
  preselected: Profile | null;
  invite: string;
  linkError: string;
  problem?: string;
  needsInvite?: string;
}) {
  // Mit vorausgewähltem Profil kann direkt erneut angefordert werden. Ohne
  // Auswahl bleibt es bei der Wegwahl: die Anfrage liegt serverseitig zur
  // E-Mail, aber hier ist nicht bekannt, welches Profil gemeint war — ein
  // stiller Wechsel auf „Ich bin neu" würde ein falsches Profil anlegen.
  const [step, setStep] = useState<Step>(
    preselected ? (linkError ? "contact" : "confirm") : "choice",
  );
  const [mode, setMode] = useState<"new" | "claim">(
    preselected ? "claim" : "new",
  );
  const [selected, setSelected] = useState<Profile | null>(preselected);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [value, setValue] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    linkError ? LINK_ERROR[linkError] || LINK_ERROR.link : problem,
  );
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
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          value: {
            kind: mode,
            ...(mode === "claim"
              ? { participantId: selected?.id, ...(invite ? { invite } : {}) }
              : {}),
            ...value,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setStep("sent");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "sent")
    return (
      <section className="auth-card card">
        <span className="icon-tile lime">
          <Check />
        </span>
        <h1>Schau in dein Postfach.</h1>
        <p>
          Wir haben den Bestätigungslink an <strong>{value.email}</strong>{" "}
          gesendet. Öffne ihn in diesem Browser — er bestätigt deine E-Mail.
          {mode === "claim" ? (
            <>
              {" "}
              Danach prüft das Deal-Operator-Team deine Übernahme von{" "}
              <strong>{selected?.name}</strong>.
            </>
          ) : (
            " Danach richtest du dein Profil ein."
          )}
        </p>
        <div className="notice">
          <strong>Deine Auswahl ist gespeichert.</strong>
          <p>
            Du musst nichts erneut eingeben. Falls der Link abläuft, kannst du
            hier jederzeit einen neuen anfordern.
          </p>
        </div>
        <button className="btn secondary" onClick={() => setStep("contact")}>
          E-Mail ändern oder Link erneut anfordern
        </button>
        <Link className="text-link" href="/ranking">
          Zum öffentlichen Ranking
        </Link>
      </section>
    );

  return (
    <section className="auth-card card">
      <span className="icon-tile lime">
        {step === "choice" ? <Sparkles /> : <ShieldCheck />}
      </span>
      <h1>
        {step === "choice"
          ? "Willkommen bei\nDeal Operator."
          : mode === "claim"
            ? "Dein vorbereitetes Profil."
            : "Dein neues Profil."}
      </h1>
      <p>
        {step === "choice"
          ? "Kostenfrei starten. Wähle deinen Einstieg."
          : mode === "claim"
            ? "Such dein Profil, dann brauchen wir nur noch deine Kontaktdaten."
            : "Ein kostenfreies Konto für deine Zahlen, deine Reflexionen und deine Call-Partner."}
      </p>

      {!ready && (
        <div className="notice">
          <strong>Die Anmeldung öffnet in Kürze.</strong>
          <p>
            Wir bereiten die sichere Speicherung vor. Das öffentliche Ranking
            zeigt schon jetzt den gemeldeten Stand.
          </p>
        </div>
      )}
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}

      {step === "choice" && needsInvite && (
        <form className="form-stack" action="/starten" method="get">
          <input type="hidden" name="profil" value={needsInvite} />
          <label>
            Code aus deiner Einladung
            <input name="einladung" required maxLength={200} autoComplete="off" />
          </label>
          <button className="btn primary full">Profil mit Einladung öffnen</button>
        </form>
      )}

      {step === "choice" && (
        <>
          <div className="onboarding-choices">
            <button
              type="button"
              onClick={() => {
                setMode("new");
                setStep("contact");
              }}
            >
              <UserRound size={20} />
              <strong>Ich bin neu</strong>
              <small>
                Erstelle dein Profil und starte mit deinen eigenen Zahlen.
              </small>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("claim");
                setStep("search");
              }}
            >
              <Search size={20} />
              <strong>Meine Zahlen sind schon auf der Seite</strong>
              <small>
                Finde dein vorbereitetes Profil und mach mit deinem bisherigen
                Stand weiter.
              </small>
            </button>
          </div>
          <p className="onboarding-signin">
            Bereits registriert?{" "}
            <Link href="/anmelden">Anmelden</Link>
          </p>
          <Link className="text-link" href="/ranking">
            Zum öffentlichen Ranking
          </Link>
        </>
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
                Wir zeigen nur vorbereitete Profile, die noch niemand übernommen
                hat. Kontaktdaten sind hier nicht sichtbar.
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
                Versuche eine andere Schreibweise. Wenn du dein Profil nicht
                findest, starte neu — wir verbinden deine bisherigen Zahlen
                später von Hand.
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
                    setStep("confirm");
                  }}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {[p.company, p.role].filter(Boolean).join(" · ") ||
                      "Vorbereitetes Profil"}
                  </small>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn secondary full"
            onClick={() => {
              setMode("new");
              setStep("contact");
            }}
          >
            Ich finde mein Profil nicht
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => setStep("choice")}
          >
            Zurück zur Auswahl
          </button>
        </>
      )}

      {step === "confirm" && selected && (
        <>
          <div className="onboarding-selected">
            <span>
              {isTeam(selected)
                ? "Du möchtest das gemeinsame Teamprofil"
                : "Du möchtest das Profil von"}
            </span>
            <strong>{selected.name}</strong>
            {[selected.company, selected.role].filter(Boolean).length > 0 && (
              <small>
                {[selected.company, selected.role].filter(Boolean).join(" · ")}
              </small>
            )}
            <span>übernehmen.</span>
          </div>
          {isTeam(selected) && (
            <div className="notice">
              <strong>Das ist ein gemeinsames Teamprofil.</strong>
              <p>
                Die Zahlen darin sind ein gemeinsames Ergebnis und werden nicht
                auf einzelne Personen aufgeteilt. Wer es übernimmt, verwaltet
                den gemeinsamen Stand. Bitte klärt vorher im Team, wer das tut.
              </p>
            </div>
          )}
          <div className="notice">
            <strong>Das Team prüft deine Übernahme.</strong>
            <p>
              Eine bestätigte E-Mail reicht dafür nicht aus. Das
              Deal-Operator-Team gleicht deine Angaben mit der bekannten Person
              ab und gibt dein Profil anschließend frei.
            </p>
          </div>
          <button
            className="btn primary full"
            onClick={() => setStep("contact")}
          >
            Weiter zu meinen Kontaktdaten
          </button>
          <p className="onboarding-signin">
            Du hast schon ein Konto?{" "}
            <Link
              href={`/anmelden?next=${encodeURIComponent(
                `/profil-uebernehmen?profil=${selected.id}${invite ? `&einladung=${invite}` : ""}`,
              )}`}
            >
              Anmelden
            </Link>
            , deine Auswahl bleibt erhalten.
          </p>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setSelected(null);
              setStep("search");
            }}
          >
            Auswahl ändern
          </button>
        </>
      )}

      {step === "contact" && (
        <form className="form-stack" onSubmit={submit}>
          {mode === "claim" && selected && (
            <div className="onboarding-selected compact">
              <span>{isTeam(selected) ? "Ausgewähltes Teamprofil" : "Ausgewähltes Profil"}</span>
              <strong>{selected.name}</strong>
              <button
                type="button"
                className="text-link"
                onClick={() => setStep("confirm")}
              >
                Auswahl ändern
              </button>
            </div>
          )}
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
              Dein echter Name hilft dem Team beim Abgleich. Öffentlich zeigen
              wir weiterhin nur deinen Anzeigenamen.
            </small>
          </label>
          <label>
            E-Mail
            <input
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={value.email}
              onChange={(e) => setValue({ ...value, email: e.target.value })}
              placeholder="du@unternehmen.de"
            />
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
              Bitte mit Ländervorwahl. Deine Nummer bleibt privat, erscheint nie
              im Ranking und wird nicht per SMS geprüft.
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
          <button className="btn primary full" disabled={!ready || busy}>
            {busy ? <LoaderCircle className="spin" /> : <Mail size={18} />}
            {mode === "claim"
              ? "E-Mail bestätigen und Übernahme anfragen"
              : "E-Mail bestätigen und Profil anlegen"}
          </button>
          <small>
            Kein Passwort nötig. Durch die Anmeldung abonnierst du keine
            Werbung.
          </small>
          <button
            type="button"
            className="text-link"
            onClick={() => setStep(mode === "claim" ? "confirm" : "choice")}
          >
            Zurück
          </button>
        </form>
      )}

      <div className="auth-note">
        <ShieldCheck size={20} />
        <span>
          Deine Kontaktdaten sehen nur du und das Deal-Operator-Team. Sie
          stehen nie im öffentlichen Ranking.
        </span>
      </div>
    </section>
  );
}
