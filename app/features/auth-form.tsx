"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, ShieldCheck, Check, LoaderCircle } from "lucide-react";
const LINK_ERROR: Record<string, string> = {
  browser:
    "Dieser Link gehört zu dem Browser, in dem du ihn angefordert hast. Fordere hier einen neuen an und öffne ihn in genau diesem Browser.",
  abgelaufen: "Dieser Anmeldelink ist abgelaufen. Fordere einen neuen an.",
  verwendet:
    "Dieser Anmeldelink wurde bereits verwendet. Fordere einen neuen an.",
  link: "Dieser Anmeldelink ist unvollständig. Fordere sicherheitshalber einen neuen an.",
};

export default function AuthForm({
  ready,
  next,
  error,
}: {
  ready: boolean;
  next: string;
  error: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    error ? LINK_ERROR[error] || LINK_ERROR.link : "",
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSent(true);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card card">
      <span className="icon-tile lime">{sent ? <Check /> : <Mail />}</span>
      <h1>
        {sent
          ? "Schau in dein Postfach."
          : "Dein nächster Call.\nDeine Zahlen im Blick."}
      </h1>
      <p>
        {sent
          ? `Wenn es für ${email} ein Konto gibt, ist der Anmeldelink unterwegs. Öffne ihn in diesem Browser. Noch nicht registriert? Dann starte unten mit „Kostenfrei starten“.`
          : "Ein Konto für deine Zahlen, deine Reflexionen und deine Call-Partner."}
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
      {!sent ? (
        <form className="form-stack" onSubmit={submit}>
          <label>
            Deine E-Mail
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="du@unternehmen.de"
            />
          </label>
          <button className="btn primary full" disabled={!ready || busy}>
            {busy ? <LoaderCircle className="spin" /> : <Mail size={18} />}
            Anmeldelink erhalten
          </button>
          <small>
            Kein Passwort nötig. Deine E-Mail wird nicht im Ranking angezeigt.
            Durch die Anmeldung abonnierst du keine Werbung.
          </small>
        </form>
      ) : (
        <button className="btn secondary" onClick={() => setSent(false)}>
          E-Mail ändern oder Link erneut anfordern
        </button>
      )}
      <div className="auth-note">
        <ShieldCheck size={20} />
        <span>
          Noch kein Konto?
          <br />
          <Link href="/beitreten">Kostenfrei starten.</Link>
        </span>
      </div>
      <Link className="text-link" href="/ranking">
        Zum öffentlichen Ranking
      </Link>
    </section>
  );
}
