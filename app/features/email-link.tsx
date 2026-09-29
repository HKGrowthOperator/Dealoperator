"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, LoaderCircle, LogIn } from "lucide-react";
import { call, PasswordField, RequestError, useStepHeading } from "./flow-parts";

type State =
  | { view: "checking" }
  | { view: "confirmed"; email: string }
  | { view: "reset"; email: string }
  | { view: "failed"; message: string };

/**
 * Link aus der eigenen Mail (server/email-code.ts). Das Geheimnis steht im
 * Teil nach „#“: Es erreicht den Server nur im Anfragetext, nie in einer
 * Adresse oder einem Protokoll, und wird sofort aus der Adresszeile entfernt.
 * - Bestätigung: sofort eingelöst. Wartet ein anderes Gerät (Registrierung),
 *   geht es dort von selbst weiter; hier meldet man sich mit dem Passwort an.
 * - Neues Passwort: erst festlegen, dann eingelöst und angemeldet.
 */
export default function EmailLink() {
  const [state, setState] = useState<State>({ view: "checking" });
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const heading = useStepHeading(state.view);

  useEffect(() => {
    // Nach dem ersten Zeichnen: Adresse lesen und den Schlüssel sofort aus
    // der Adresszeile nehmen (Verlauf, Teilen, Neuladen).
    const timer = setTimeout(() => {
      const found = window.location.hash.replace(/^#/, "");
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
      if (!found) {
        setState({
          view: "failed",
          message: "Dieser Link ist unvollständig. Öffne ihn bitte direkt aus der Mail.",
        });
        return;
      }
      setKey(found);
      call<{ purpose: "confirm" | "reset"; email: string }>("/api/auth", { action: "link", key: found })
        .then((data) =>
          setState(
            data.purpose === "reset"
              ? { view: "reset", email: data.email }
              : { view: "confirmed", email: data.email },
          ),
        )
        .catch((e: RequestError) => setState({ view: "failed", message: e.message }));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || (state.view !== "confirmed" && state.view !== "reset")) return;
    if (!password) {
      setPasswordError(state.view === "reset" ? "Bitte lege ein neues Passwort fest." : "Bitte gib dein Passwort ein.");
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setPasswordError("");
    try {
      const data = await call<{ next?: string }>(
        "/api/auth",
        state.view === "reset"
          ? { action: "resetLink", key, password, next: "/" }
          : { action: "signin", email: state.email, password, next: "/tagesabschluss" },
      );
      if (data.next) window.location.assign(data.next);
      else setBusy(false);
    } catch (err) {
      const e = err as RequestError;
      setPasswordError(e.message);
      setBusy(false);
      passwordRef.current?.focus();
    }
  }

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={state.view}>
        {state.view === "checking" && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              Einen Moment …
            </h1>
            <p className="flow-waiting" aria-live="polite">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              <span>Wir prüfen deinen Link.</span>
            </p>
          </>
        )}

        {state.view === "failed" && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              Das hat nicht geklappt.
            </h1>
            <p className="form-error" role="alert">
              {state.message}
            </p>
            <div className="flow-actions">
              <Link className="btn primary full" href="/anmelden">
                <LogIn size={18} aria-hidden="true" />
                Zur Anmeldung
              </Link>
            </div>
          </>
        )}

        {(state.view === "confirmed" || state.view === "reset") && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {state.view === "reset" ? "Neues Passwort festlegen." : "E-Mail bestätigt."}
            </h1>
            {state.view === "confirmed" ? (
              <p className="flow-waiting">
                <CircleCheck size={18} aria-hidden="true" />
                <span>
                  Deine Adresse ist bestätigt. Hast du dich auf einem anderen Gerät registriert, geht es dort
                  von selbst weiter. Hier meldest du dich mit deinem Passwort an.
                </span>
              </p>
            ) : (
              <p className="flow-lead">
                Für <strong className="flow-address">{state.email}</strong>. Danach bist du direkt angemeldet.
              </p>
            )}
            <form className="flow-form" onSubmit={submit} noValidate>
              <input type="hidden" name="email" autoComplete="username" value={state.email} readOnly />
              <PasswordField
                value={password}
                onChange={(value) => {
                  setPassword(value);
                  setPasswordError("");
                }}
                error={passwordError}
                autoComplete={state.view === "reset" ? "new-password" : "current-password"}
                inputRef={passwordRef}
                label={state.view === "reset" ? "Neues Passwort" : "Passwort"}
                note={state.view === "reset" ? "Mindestens 8 Zeichen." : undefined}
              />
              <button className="btn primary full" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}
                {state.view === "reset" ? "Passwort speichern und anmelden" : "Anmelden"}
              </button>
            </form>
            {state.view === "confirmed" && (
              <p className="flow-small">
                Passwort vergessen? <Link href="/anmelden">Über die Anmeldung</Link> legst du ein neues fest.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
