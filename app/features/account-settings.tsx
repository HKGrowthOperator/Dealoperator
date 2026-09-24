"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PHONE_COUNTRIES, splitPhone } from "@/lib/phone";

/** Rückweg nach dem Ergänzen, z. B. zum begonnenen Tagesabschluss. */
function returnTarget(value: string | null) {
  if (!value || !/^\/(tagesabschluss|reflexionen)(\?[a-zA-Z0-9=&_-]*)?$/.test(value)) return null;
  return value;
}

/**
 * Ein Profil, ein Speichern: Name, Firma, Rolle und Nummer gelten für die
 * Rangliste und für Call-Partner. `extra` sind die Call-Partner-Angaben
 * (Zielgruppe, Zeit, Tage); `onSaved` speichert sie im selben Schritt.
 */
export default function AccountSettings({
  demo,
  extra,
  onSaved,
  standalone,
}: {
  demo: boolean;
  extra?: ReactNode;
  onSaved?: (identity: { name: string; role: string }) => Promise<boolean>;
  /** Ohne eigenes Profil: stattdessen gezeigt (z. B. das Call-Profil allein). */
  standalone?: ReactNode;
}) {
  const router = useRouter();
  const uid = useId();
  const back = returnTarget(useSearchParams().get("weiter"));
  const [value, setValue] = useState({
    name: demo ? "Alex · Beispiel" : "",
    company: "",
    role: demo ? "Sales" : "",
    publicConsent: false,
    phone: "",
    phoneCountry: "DE",
    contactOptIn: false,
  });
  const [exists, setExists] = useState(demo);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(demo ? "alex@beispiel.invalid" : "");
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    fetch("/api/operator", { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setEmail(d.email);
        setExists(!!d.participant);
        if (d.participant)
          setValue({
            name: d.participant.name,
            company: d.participant.company,
            role: d.participant.role,
            publicConsent: d.participant.public_consent,
            // Gespeichert ist +49170…; im Feld stehen Land und nationale Ziffern.
            phone: splitPhone(d.contact.phone || "").national,
            phoneCountry: splitPhone(d.contact.phone || "").country,
            contactOptIn: d.contact.contact_opt_in,
          });
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [demo]);
  return (
    <section className="card padded operator-account" id="konto">
      <h2>Dein Profil</h2>
      <p className="hint">
        {demo ? "Beispielkonto" : `${email} · E-Mail bestätigt`}
      </p>
      {back && (
        <p className="account-return" role="status">
          Nummer eintragen und speichern, dann geht es mit deinem Entwurf weiter.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!exists ? (
        <>
          <p>
            Stehen deine Zahlen schon in der Rangliste?{" "}
            <Link className="text-link" href="/profil-uebernehmen">
              Übernahme anfragen
            </Link>
            . Sonst speicherst du nach dem Ausfüllen deines Profils deinen ersten
            Tagesabschluss.
          </p>
          {standalone}
        </>
      ) : (
        <form
          className="checkin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (!demo) {
                const r = await fetch("/api/operator", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "account", value }),
                });
                const d = await r.json();
                if (!r.ok) throw Error(d.error);
              }
              // Call-Partner-Angaben im selben Schritt; Name und Rolle von oben.
              if (onSaved && !(await onSaved({ name: value.name.trim(), role: value.role.trim() })))
                return;
              toast.success(
                demo
                  ? "Beispieleinstellungen aktualisiert."
                  : back
                    ? "Gespeichert. Es geht weiter, wo du warst."
                    : "Dein Profil ist gespeichert.",
              );
              if (back && !demo && value.phone.trim()) router.push(back);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="checkin-fields">
            <label>
              Anzeigename in der Rangliste
              <input
                required
                minLength={2}
                maxLength={60}
                value={value.name}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
              />
            </label>
            <label>
              Firma
              <input
                maxLength={120}
                value={value.company}
                onChange={(e) =>
                  setValue({ ...value, company: e.target.value })
                }
              />
            </label>
            <label>
              Rolle
              <input
                maxLength={80}
                value={value.role}
                onChange={(e) => setValue({ ...value, role: e.target.value })}
              />
            </label>
            <div className="account-phone">
              <label htmlFor={`${uid}-phone`}>Nummer</label>
              <span className="flow-phone">
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
                  id={`${uid}-phone`}
                  type="tel"
                  inputMode="tel"
                  maxLength={40}
                  autoComplete="tel"
                  autoFocus={!!back && !value.phone}
                  value={value.phone}
                  onChange={(e) => setValue({ ...value, phone: e.target.value })}
                />
              </span>
            </div>
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={value.publicConsent}
              onChange={(e) =>
                setValue({ ...value, publicConsent: e.target.checked })
              }
            />
            <span>
              Mein Profil und meine gemeldeten Zahlen in der öffentlichen Rangliste
              anzeigen. Sichtbar: Anzeigename, Firma, Rolle und Kennzahlen.
              Ich kann das jederzeit hier zurücknehmen.
            </span>
          </label>
          <div className="notice">
            <strong>So erscheinst du:</strong>
            <p>
              {value.name || "Dein Anzeigename"} ·{" "}
              {value.company || "Keine Firma"} · {value.role || "Keine Rolle"}
              <br />
              {value.publicConsent
                ? "Profil und gemeldete Zahlen sind im offenen Internet sichtbar."
                : "Dein Profil und deine Zahlen erscheinen nicht in der öffentlichen Rangliste."}
            </p>
          </div>
          {extra && (
            <fieldset className="account-extra">
              <legend>Für Call-Partner</legend>
              {extra}
            </fieldset>
          )}
          <button className="btn primary" disabled={busy}>
            {back ? "Speichern und weiter" : "Speichern"}
          </button>
        </form>
      )}
    </section>
  );
}

/** Passwort und Abmelden: ruhig am Ende, getrennt vom Speichern. */
export function AccountAccess() {
  const [error, setError] = useState("");
  return (
    <section className="card padded account-access" aria-labelledby="account-access-title">
      <h2 id="account-access-title">Anmeldung</h2>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-access-actions">
        <Link className="btn secondary" href="/passwort">
          Passwort festlegen oder ändern
        </Link>
        <button
          type="button"
          className="do-link"
          onClick={async () => {
            const r = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "signout" }),
            });
            // A full navigation discards all private in-memory state after sign-out.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            if (r.ok) window.location.href = "/";
            else setError("Abmelden gerade nicht möglich. Bitte erneut versuchen.");
          }}
        >
          Abmelden
        </button>
      </div>
    </section>
  );
}
