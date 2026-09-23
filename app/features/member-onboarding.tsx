"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle, PartyPopper, Plus, UserRound } from "lucide-react";
import { DEFAULT_PHONE_COUNTRY, normalisePhone, PHONE_COUNTRIES } from "@/lib/phone";
import { call, FlowProgress, RequestError, useStepHeading } from "./flow-parts";

/**
 * Profil anlegen nach bestätigter E-Mail (Weg „Ich starte neu“). Gefragt wird
 * nur, was noch fehlt: Anzeigename, Telefon nur ohne hinterlegte Nummer,
 * Sichtbarkeit. Danach geht es zum ersten Tagesabschluss. Eine
 * Profilübernahme läuft nicht hierüber, sondern über die Teamfreigabe.
 */
export default function MemberOnboarding({
  next,
  presetName,
  needsPhone,
  discordUrl,
  takenProfile = "",
}: {
  next: string;
  presetName: string;
  needsPhone: boolean;
  discordUrl: string;
  /** Übernahme lief ins Leere: Profil inzwischen anderweitig zugeordnet. */
  takenProfile?: string;
}) {
  const id = useId();
  const [value, setValue] = useState({
    name: presetName,
    company: "",
    role: "",
    publicConsent: false,
    phone: "",
    phoneCountry: DEFAULT_PHONE_COUNTRY as string,
  });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const heading = useStepHeading(done ? "done" : "form");
  const later = next.startsWith("/tagesabschluss") ? "/heute?modus=eigen" : next;

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
          publicConsent: value.publicConsent,
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
          <span className="icon-tile lime">
            <PartyPopper />
          </span>
          <h1 ref={heading} tabIndex={-1}>
            Dein Profil ist angelegt.
          </h1>
          <p className="flow-lead">
            Als Nächstes trägst du deinen ersten Calling-Tag ein: Zahlen und ein
            kurzer Gedanke dazu.
          </p>
          <div className="flow-actions">
            <Link className="btn primary full" href="/tagesabschluss">
              Ersten Tagesabschluss eintragen
            </Link>
            <Link className="flow-link" href={later}>
              Erst umsehen
            </Link>
          </div>
          <div className="flow-notice">
            <strong>Austausch auf Discord</strong>
            <p>
              Fragen, Calls und Learnings teilen die Caller auf Discord. Kostenfrei
              und freiwillig.{" "}
              <a href={discordUrl} target="_blank" rel="noopener noreferrer">
                Discord öffnen
              </a>
            </p>
          </div>
        </div>
      </section>
    );

  return (
    <section className="auth-card card flow">
      <div className="flow-step">
        <FlowProgress
          steps={["Weg wählen", "Deine Angaben", "E-Mail bestätigen", "Profil anlegen"]}
          current={3}
        />
        <span className="icon-tile lime">
          <UserRound />
        </span>
        <h1 ref={heading} tabIndex={-1}>
          E-Mail bestätigt. Leg dein Profil an.
        </h1>
        <p className="flow-lead">
          Noch dein Anzeigename, dann trägst du deinen ersten Tag ein.
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
              {errors.name || "So sehen dich die anderen. Dein voller Name bleibt beim Team."}
            </p>
          </div>

          {needsPhone && (
            <div className="flow-field" data-invalid={errors.phone ? "" : undefined}>
              <label htmlFor={`${id}-phone`}>Telefon</label>
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
                  aria-describedby={`${id}-phone-note`}
                />
              </div>
              <p id={`${id}-phone-note`} className={errors.phone ? "flow-field-error" : "flow-note"}>
                {errors.phone ||
                  "Nur für dich und das Team sichtbar. Wird nicht per SMS geprüft."}
              </p>
            </div>
          )}

          {more ? (
            <>
              <div className="flow-field">
                <label htmlFor={`${id}-company`}>Unternehmen (optional)</label>
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
              <Plus size={16} aria-hidden="true" /> Unternehmen und Rolle angeben
            </button>
          )}

          <label className="flow-check">
            <input
              type="checkbox"
              checked={value.publicConsent}
              onChange={(e) => setValue({ ...value, publicConsent: e.target.checked })}
            />
            <span>
              Meine Zahlen mit Anzeigename im öffentlichen Ranking zeigen. E-Mail
              und Telefon bleiben privat. Das kannst du später ändern.
            </span>
          </label>

          <button className="btn primary full" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}
            Profil anlegen
          </button>
        </form>
        <p className="flow-small">
          Deine Zahlen stehen schon im Ranking?{" "}
          <Link href="/profil-uebernehmen">Profil übernehmen</Link>
        </p>
      </div>
    </section>
  );
}
