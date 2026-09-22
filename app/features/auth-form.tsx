"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, ShieldCheck, Check, LoaderCircle } from "lucide-react";
export default function AuthForm({
  ready,
  next,
  error,
}: {
  ready: boolean;
  next: string;
  error: boolean;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    error
      ? "Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen an."
      : "",
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
          : "Dein nächster Call.\nMit deiner Crew."}
      </h1>
      <p>
        {sent
          ? `Wir haben den Anmeldelink an ${email} gesendet. Öffne ihn in diesem Browser. Der Link bestätigt deine E-Mail und meldet dich an.`
          : "Ein kostenfreies Konto für deine Zahlen, Reflexionen und die Menschen, die mit dir dranbleiben."}
      </p>
      {!ready && (
        <div className="notice">
          <strong>Die Anmeldung öffnet in Kürze.</strong>
          <p>
            Wir bereiten die sichere Speicherung vor. Du kannst alle
            Community-Bereiche schon mit Beispieldaten erkunden.
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
          Schon Zahlen eingereicht?
          <br />
          <Link href="/profil-uebernehmen">
            Übernimm dein bestehendes Profil.
          </Link>
        </span>
      </div>
      <Link className="text-link" href="/heute?modus=demo">
        Erst einmal umsehen
      </Link>
    </section>
  );
}
