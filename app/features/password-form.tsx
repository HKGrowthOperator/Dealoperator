"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, KeyRound, LoaderCircle } from "lucide-react";
import { call, checkPassword, PasswordField, RequestError, useStepHeading } from "./flow-parts";

/**
 * Passwort festlegen oder ändern (angemeldet). Das versteckte Feld mit der
 * E-Mail sagt dem Passwort-Manager, zu welchem Konto das neue Passwort gehört.
 */
export default function PasswordForm({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const heading = useStepHeading(done ? "done" : "form");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const problem = checkPassword(password);
    setError(problem);
    setMessage("");
    if (problem) return input.current?.focus();
    inFlight.current = true;
    setBusy(true);
    try {
      await call("/api/auth", { action: "setPassword", password });
      setDone(true);
      setPassword("");
    } catch (err) {
      const e = err as RequestError;
      if (e.field === "password") {
        setError(e.message);
        input.current?.focus();
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
            <CircleCheck />
          </span>
          <h1 ref={heading} tabIndex={-1}>
            Passwort gespeichert.
          </h1>
          <p className="flow-lead">
            Ab jetzt meldest du dich mit <strong className="flow-address">{email}</strong> und
            diesem Passwort an, ganz ohne Mail. Auf diesem Gerät bleibst du angemeldet.
          </p>
          <div className="flow-actions">
            <Link className="btn primary full" href="/start">
              Weiter
            </Link>
          </div>
        </div>
      </section>
    );

  return (
    <section className="auth-card card flow">
      <div className="flow-step">
        <span className="icon-tile lime">
          <KeyRound />
        </span>
        <h1 ref={heading} tabIndex={-1}>
          {hasPassword ? "Passwort ändern." : "Passwort festlegen."}
        </h1>
        <p className="flow-lead">
          Damit meldest du dich künftig mit E-Mail und Passwort an, ohne Mail. Dein
          Passwort-Manager kann es speichern.
        </p>
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <form className="flow-form" onSubmit={submit} noValidate>
          <input
            className="sr-only"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <PasswordField
            label={hasPassword ? "Neues Passwort" : "Passwort"}
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError("");
            }}
            error={error}
            autoComplete="new-password"
            inputRef={input}
            note="Mindestens 8 Zeichen."
          />
          <button className="btn primary full" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}
            Passwort speichern
          </button>
        </form>
      </div>
    </section>
  );
}
