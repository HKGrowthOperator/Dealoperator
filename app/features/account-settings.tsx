"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
export default function AccountSettings({ demo }: { demo: boolean }) {
  const [value, setValue] = useState({
    name: demo ? "Alex · Beispiel" : "",
    company: "",
    role: demo ? "Sales" : "",
    publicConsent: false,
    phone: "",
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
            phone: d.contact.phone,
            contactOptIn: d.contact.contact_opt_in,
          });
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [demo]);
  return (
    <section className="card padded operator-account">
      <h2>Konto & öffentliche Sichtbarkeit</h2>
      <p className="hint">
        {demo ? "Beispielkonto" : `${email} · E-Mail bestätigt`}. Für deinen
        eigenen Tagesabschluss und das Lesen der Reflexionen brauchst du eine
        Telefonnummer mit Ländervorwahl. Sie wird nicht per SMS geprüft und ist
        nur für das Team sichtbar.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!exists ? (
        <p>
          Du kannst{" "}
          <Link className="text-link" href="/profil-uebernehmen">
            dein bestehendes Profil übernehmen
          </Link>{" "}
          oder nach dem Ausfüllen deines Crew-Profils den ersten Check-in
          speichern.
        </p>
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
              toast.success(
                demo
                  ? "Beispieleinstellungen aktualisiert."
                  : "Einstellungen gespeichert.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="checkin-fields">
            <label>
              Anzeigename im Ranking
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
            <label>
              Telefonnummer · nur für das Team, mit Ländervorwahl
              <input
                type="tel"
                maxLength={40}
                autoComplete="tel"
                value={value.phone}
                onChange={(e) => setValue({ ...value, phone: e.target.value })}
              />
            </label>
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
              Mein Profil und meine gemeldeten Zahlen im öffentlichen
              Community-Ranking anzeigen. Sichtbar: Anzeigename, Firma, Rolle
              und Kennzahlen. Ich kann das jederzeit hier zurücknehmen.
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
                : "Dein Profil und deine Zahlen erscheinen nicht im öffentlichen Ranking."}
            </p>
          </div>
          <button className="btn primary" disabled={busy}>
            Einstellungen speichern
          </button>
        </form>
      )}
      {!demo && (
        <button
          className="btn secondary"
          onClick={async () => {
            const r = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "signout" }),
            });
            // A full navigation discards all private in-memory state after sign-out.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            if (r.ok) window.location.href = "/";
            else
              setError(
                "Abmelden gerade nicht möglich. Bitte erneut versuchen.",
              );
          }}
        >
          Abmelden
        </button>
      )}
    </section>
  );
}
