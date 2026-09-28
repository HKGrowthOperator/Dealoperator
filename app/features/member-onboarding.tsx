"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, LoaderCircle, Plus, Search, UserRound } from "lucide-react";
import { DEFAULT_PHONE_COUNTRY, normalisePhone, PHONE_COUNTRIES } from "@/lib/phone";
import {
  call,
  FlowProgress,
  profileMeta,
  RequestError,
  useStepHeading,
  type Profile,
} from "./flow-parts";

/**
 * Profil einrichten für ein angemeldetes Konto ohne Profil. Wer schon in der
 * Rangliste steht, erkennt zuerst sein Profil (Vorschläge zum Namen) und
 * übernimmt es über die Teamfreigabe; wer neu ist, gibt nur den Anzeigenamen
 * an (Telefon nur ohne hinterlegte Nummer) und trägt danach direkt den ersten
 * Tag ein. Eine Übernahme läuft nie hierüber, sondern über die Teamfreigabe.
 */
export default function MemberOnboarding({
  next,
  presetName,
  needsPhone,
  discordUrl,
  takenProfile = "",
  suggestions = [],
  fromRegistration = false,
}: {
  next: string;
  presetName: string;
  needsPhone: boolean;
  discordUrl: string;
  /** Übernahme lief ins Leere: Profil inzwischen anderweitig zugeordnet. */
  takenProfile?: string;
  /** Profile in der Rangliste, die zum Namen der Person passen. */
  suggestions?: Profile[];
  /** Direkt aus der Registrierung (E-Mail gerade bestätigt), nicht aus einer Anmeldung. */
  fromRegistration?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState({
    name: presetName,
    company: "",
    role: "",
    phone: "",
    phoneCountry: DEFAULT_PHONE_COUNTRY as string,
  });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showForm, setShowForm] = useState(suggestions.length === 0);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const heading = useStepHeading(done ? "done" : showForm ? "form" : "suggest");
  const later = next.startsWith("/tagesabschluss") ? "/" : next;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const found: typeof errors = {};
    if (value.name.trim().length < 2) found.name = "Bitte gib einen Anzeigenamen an.";
    if (needsPhone) {
      const phone = normalisePhone(value.phone, value.phoneCountry);
      if (!phone.ok) found.phone = phone.reason;
    }
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.phone) return phoneRef.current?.focus();
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await call("/api/operator", {
        action: "onboard",
        value: {
          name: value.name.trim(),
          company: value.company.trim(),
          role: value.role.trim(),
          ...(needsPhone ? { phone: value.phone.trim(), phoneCountry: value.phoneCountry } : {}),
        },
      });
      // Kein Neuladen: /start leitet mit fertigem Profil sofort weiter, die
      // Erfolgsansicht mit dem nächsten Schritt soll aber stehen bleiben.
      setDone(true);
    } catch (err) {
      const e = err as RequestError;
      if (e.field === "phone") {
        setErrors({ phone: e.message });
        phoneRef.current?.focus();
      } else if (e.field === "name") {
        setErrors({ name: e.message });
        nameRef.current?.focus();
      } else setMessage(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="auth-card card flow">
        <div className="flow-step">
          <h1 ref={heading} tabIndex={-1}>
            Dein Profil ist angelegt.
          </h1>
          <p className="flow-lead">
            Jetzt fehlt nur noch dein erster Tag: Zahlen und zwei kurze Antworten.
          </p>
          <div className="flow-actions">
            <Link className="btn primary full" href="/tagesabschluss">
              Zahlen für heute eintragen
            </Link>
            <Link className="flow-link" href={later}>
              Erst die Ergebnisse ansehen
            </Link>
          </div>
          <div className="flow-notice">
            <strong>Calls und Roleplay laufen im Discord</strong>
            <p>
              Dort findet ihr euch zum Üben und pusht euch gegenseitig. Kostenfrei und
              freiwillig.{" "}
              <a href={discordUrl} target="_blank" rel="noopener noreferrer">
                Discord öffnen
              </a>
            </p>
          </div>
        </div>
      </section>
    );

  // Erst erkennen, dann anlegen: Wer schon in der Rangliste steht, übernimmt
  // sein Profil; das Team prüft die Zuordnung, ein zweites Profil entsteht nicht.
  if (!showForm) {
    // Genau ein Treffer: die Frage direkt mit dem Namen stellen.
    const single = suggestions.length === 1 ? suggestions[0] : null;
    return (
      <section className="auth-card card flow">
        <div className="flow-step">
          <h1 ref={heading} tabIndex={-1}>
            {single ? `Bist du ${single.name}?` : "Bist du schon in der Rangliste?"}
          </h1>
          <p className="flow-lead">
            {single
              ? "Dieses Profil aus der Rangliste passt zu deinem Namen."
              : "Diese Profile passen zu deinem Namen."}
          </p>
          <div className="flow-choices">
            {suggestions.map((p) => (
              <Link
                key={p.id}
                className="flow-option"
                href={`/profil-uebernehmen?profil=${encodeURIComponent(p.id)}`}
              >
                <UserRound aria-hidden="true" />
                <span>
                  <strong>{single ? "Ja, das bin ich" : p.name}</strong>
                  <small>{profileMeta(p) || "Steht in der Rangliste"}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
          <div className="flow-actions">
            <button type="button" className="btn secondary full" onClick={() => setShowForm(true)}>
              {single ? "Nein, ich bin neu hier" : "Keins davon, ich bin neu hier"}
            </button>
            <Link className="flow-link" href="/profil-uebernehmen">
              Anderes Profil suchen
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-card card flow">
      <div className="flow-step">
        {fromRegistration && (
          <FlowProgress
            steps={["Deine Angaben", "E-Mail bestätigen", "Profil anlegen"]}
            current={2}
          />
        )}
        <h1 ref={heading} tabIndex={-1}>
          {fromRegistration ? "E-Mail bestätigt. Leg dein Profil an." : "Leg dein Profil an."}
        </h1>
        <p className="flow-lead">
          {needsPhone
            ? "Anzeigename und Nummer, dann trägst du deinen ersten Tag ein."
            : "Nur dein Anzeigename, dann trägst du deinen ersten Tag ein."}
        </p>
        {takenProfile && (
          <div className="flow-alert">
            <p>
              „{takenProfile}“ wurde inzwischen einem anderen Konto zugeordnet.
              Wenn es dein Profil ist, klärt das Team die Zuordnung.
            </p>
            <Link className="btn secondary" href="/profil-uebernehmen?weg=team">
              Team um Zuordnung bitten
            </Link>
          </div>
        )}
        {!takenProfile && suggestions.length === 0 && (
          <div className="flow-choices">
            <Link className="flow-option" href="/profil-uebernehmen">
              <Search aria-hidden="true" />
              <span>
                <strong>Meine Zahlen sind schon hier</strong>
                <small>Profil in der Rangliste suchen und mit allen bisherigen Tagen übernehmen.</small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </div>
        )}
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <form className="flow-form" onSubmit={submit} noValidate>
          <div className="flow-field" data-invalid={errors.name ? "" : undefined}>
            <label htmlFor={`${id}-name`}>Anzeigename</label>
            <input
              id={`${id}-name`}
              ref={nameRef}
              autoComplete="nickname"
              autoCapitalize="words"
              maxLength={60}
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={`${id}-name-note`}
            />
            <p id={`${id}-name-note`} className={errors.name ? "flow-field-error" : "flow-note"}>
              {errors.name || "So stehst du in der Rangliste. E-Mail und Nummer bleiben privat."}
            </p>
          </div>

          {needsPhone && (
            <div className="flow-field" data-invalid={errors.phone ? "" : undefined}>
              <label htmlFor={`${id}-phone`}>Nummer</label>
              <div className="flow-phone">
                <select
                  aria-label="Ländervorwahl"
                  value={value.phoneCountry}
                  onChange={(e) => setValue({ ...value, phoneCountry: e.target.value })}
                >
                  {PHONE_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} +{c.dial}
                    </option>
                  ))}
                </select>
                <input
                  id={`${id}-phone`}
                  ref={phoneRef}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={40}
                  value={value.phone}
                  onChange={(e) => setValue({ ...value, phone: e.target.value })}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? `${id}-phone-error` : undefined}
                />
              </div>
              {errors.phone && (
                <p id={`${id}-phone-error`} className="flow-field-error">
                  {errors.phone}
                </p>
              )}
            </div>
          )}

          {more ? (
            <>
              <div className="flow-field">
                <label htmlFor={`${id}-company`}>Firma (optional)</label>
                <input
                  id={`${id}-company`}
                  autoComplete="organization"
                  maxLength={120}
                  value={value.company}
                  onChange={(e) => setValue({ ...value, company: e.target.value })}
                />
              </div>
              <div className="flow-field">
                <label htmlFor={`${id}-role`}>Rolle (optional)</label>
                <input
                  id={`${id}-role`}
                  autoComplete="organization-title"
                  maxLength={80}
                  placeholder="Zum Beispiel Setter oder Closer"
                  value={value.role}
                  onChange={(e) => setValue({ ...value, role: e.target.value })}
                />
              </div>
            </>
          ) : (
            <button type="button" className="flow-link flow-add" onClick={() => setMore(true)}>
              <Plus size={16} aria-hidden="true" /> Firma und Rolle angeben
            </button>
          )}

          <button className="btn primary full" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}
            Profil anlegen
          </button>
        </form>
        {suggestions.length > 0 && (
          <p className="flow-small">
            Doch schon in der Rangliste?{" "}
            <button type="button" className="flow-link" onClick={() => setShowForm(false)}>
              Zu den Vorschlägen
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
