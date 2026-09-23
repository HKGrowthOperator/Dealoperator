"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle, LogIn, Mail } from "lucide-react";
import {
  call,
  EmailSent,
  InAppHint,
  linkErrorText,
  RequestError,
  takeLinkError,
  useCountdown,
  useStepHeading,
} from "./flow-parts";

/** Wohin es nach der Anmeldung geht, in Worten. */
function targetLabel(next: string) {
  const path = new URL(next, "https://operator.invalid").pathname;
  if (path === "/tagesabschluss") return "zum Tagesabschluss";
  if (path === "/profil-uebernehmen") return "zur Profilübernahme";
  if (path === "/verwaltung") return "zur Verwaltung";
  if (path === "/reflexionen") return "zu den Reflexionen";
  return "";
}

/**
 * Anmeldung für bestehende Konten: E-Mail eingeben, Mail bestätigen, fertig.
 * Das ursprüngliche Ziel (next) bleibt über den ganzen Weg erhalten.
 */
export default function AuthForm({
  ready,
  next,
  error,
  codeEnabled,
}: {
  ready: boolean;
  next: string;
  error: string;
  codeEnabled: boolean;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState(linkErrorText(error, codeEnabled));
  const [sendError, setSendError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [waitFor, setWaitFor] = useState("");
  const [wait, setWait] = useCountdown(0);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const heading = useStepHeading(sentTo ? "sent" : "form");
  // Nach „E-Mail-Adresse ändern“ ins Feld statt auf die Überschrift.
  const focusInput = useRef(false);
  useEffect(() => {
    if (!sentTo && focusInput.current) {
      focusInput.current = false;
      input.current?.focus();
    }
  }, [sentTo]);
  const target = targetLabel(next);
  const startHref = (() => {
    const url = new URL(next, "https://operator.invalid");
    if (url.pathname !== "/profil-uebernehmen") return "/starten";
    const params = new URLSearchParams();
    for (const key of ["profil", "einladung"]) {
      const value = url.searchParams.get(key);
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return `/starten${query ? `?${query}` : ""}`;
  })();

  useEffect(() => {
    const timer = setTimeout(() => {
      const reason = takeLinkError();
      if (reason && reason !== error) setMessage(linkErrorText(reason, codeEnabled));
    }, 0);
    return () => clearTimeout(timer);
  }, [error, codeEnabled]);

  async function send(resend: boolean) {
    if (inFlight.current) return;
    const address = (resend ? sentTo : email).trim().toLowerCase();
    if (!resend) {
      if (!address) return fail("Bitte gib deine E-Mail-Adresse an.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address))
        return fail("Bitte prüfe deine E-Mail-Adresse.");
    }
    inFlight.current = true;
    if (resend) setResending(true);
    else setBusy(true);
    setMessage("");
    setSendError("");
    setFieldError("");
    setResent(false);
    try {
      const data = await call<{ resendAfter?: number }>("/api/auth", { email: address, next });
      setWaitFor(address);
      setWait(data.resendAfter || 60);
      setSentTo(address);
      if (resend) setResent(true);
    } catch (err) {
      const e = err as RequestError;
      if (e.retryAfter) {
        setWaitFor(address);
        setWait(e.retryAfter);
      }
      if (resend) setSendError(e.message);
      else if (e.field === "email" || e.status === 400) fail(e.message);
      else setMessage(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setResending(false);
    }
  }

  function fail(text: string) {
    setFieldError(text);
    input.current?.focus();
  }

  const blocked = wait > 0 && email.trim().toLowerCase() === waitFor;

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={sentTo ? "sent" : "form"}>
        {sentTo ? (
          <EmailSent
            email={sentTo}
            purpose="signin"
            codeEnabled={codeEnabled}
            next={next}
            saved={false}
            resendIn={wait}
            resent={resent}
            resending={resending}
            error={sendError}
            onResend={() => void send(true)}
            onChangeEmail={() => {
              focusInput.current = true;
              setSentTo("");
            }}
            headingRef={heading}
          />
        ) : (
          <>
            <span className="icon-tile lime">
              <LogIn />
            </span>
            <h1 ref={heading} tabIndex={-1}>
              Bei Deal Operator anmelden.
            </h1>
            <p className="flow-lead">
              {codeEnabled
                ? "Gib deine E-Mail ein. Wir schicken dir einen Link und einen Code zum Anmelden."
                : "Gib deine E-Mail ein. Wir schicken dir einen Link zum Anmelden."}
              {target && ` Danach geht es direkt weiter ${target}.`}
            </p>
            {!ready && (
              <div className="flow-notice">
                <strong>Die Anmeldung öffnet in Kürze.</strong>
                <p>Das öffentliche Ranking zeigt schon jetzt den gemeldeten Stand.</p>
              </div>
            )}
            {message && (
              <p className="form-error" role="alert">
                {message}
              </p>
            )}
            <InAppHint codeEnabled={codeEnabled} />
            <form
              className="flow-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void send(false);
              }}
            >
              <div className="flow-field" data-invalid={fieldError ? "" : undefined}>
                <label htmlFor={`${id}-email`}>E-Mail</label>
                <input
                  id={`${id}-email`}
                  ref={input}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  maxLength={254}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldError("");
                  }}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${id}-error` : undefined}
                />
                {fieldError && (
                  <p id={`${id}-error`} className="flow-field-error">
                    {fieldError}
                  </p>
                )}
              </div>
              <button className="btn primary full" disabled={!ready || busy || blocked}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Mail size={18} />}
                Anmeldemail senden
                {blocked && (
                  <span className="flow-wait">
                    {" "}
                    ({Math.floor(wait / 60)}:{String(wait % 60).padStart(2, "0")})
                  </span>
                )}
              </button>
            </form>
            <p className="flow-small">Kein Passwort nötig. Deine E-Mail steht nie im Ranking.</p>
            <p className="flow-signin">
              Noch kein Konto? <Link href={startHref}>Kostenfrei starten</Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
