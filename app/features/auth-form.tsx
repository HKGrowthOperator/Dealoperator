"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, LoaderCircle, LogIn, Mail } from "lucide-react";
import {
  call,
  EmailSent,
  InAppHint,
  linkErrorText,
  PasswordField,
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Anmeldung für bestehende Konten mit E-Mail und Passwort, ohne Mail. Der
 * Passwort-Manager kann beides speichern. Nur wer das Passwort vergessen oder
 * noch keins festgelegt hat, bekommt einmalig einen Anmeldelink und legt
 * danach eines fest. Das ursprüngliche Ziel (next) bleibt erhalten.
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
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState(linkErrorText(error, codeEnabled));
  const [sendError, setSendError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [waitFor, setWaitFor] = useState("");
  const [wait, setWait] = useCountdown(0);
  const inFlight = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const view = sentTo ? "sent" : mode;
  const heading = useStepHeading(view);
  // Nach „E-Mail-Adresse ändern“ ins Feld statt auf die Überschrift.
  const focusInput = useRef(false);
  useEffect(() => {
    if (!sentTo && focusInput.current) {
      focusInput.current = false;
      emailInput.current?.focus();
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

  function failEmail(text: string) {
    setEmailError(text);
    emailInput.current?.focus();
  }

  async function signIn() {
    if (inFlight.current) return;
    const address = email.trim().toLowerCase();
    setEmailError("");
    setPasswordError("");
    setMessage("");
    if (!address) return failEmail("Bitte gib deine E-Mail-Adresse an.");
    if (!EMAIL.test(address)) return failEmail("Bitte prüfe deine E-Mail-Adresse.");
    if (!password) {
      setPasswordError("Bitte gib dein Passwort ein.");
      passwordInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const data = await call<{ next: string }>("/api/auth", {
        action: "signin",
        email: address,
        password,
        next,
      });
      // Vollständiger Seitenwechsel: der Passwort-Manager bietet danach das
      // Speichern an, und die neue Sitzung gilt überall.
      window.location.assign(data.next);
    } catch (err) {
      const e = err as RequestError;
      if (e.field === "password") {
        setPasswordError(e.message);
        passwordInput.current?.focus();
      } else if (e.field === "email") failEmail(e.message);
      else setMessage(e.message);
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function sendLink(resend: boolean) {
    if (inFlight.current) return;
    const address = (resend ? sentTo : email).trim().toLowerCase();
    if (!resend) {
      setEmailError("");
      if (!address) return failEmail("Bitte gib deine E-Mail-Adresse an.");
      if (!EMAIL.test(address)) return failEmail("Bitte prüfe deine E-Mail-Adresse.");
    }
    inFlight.current = true;
    if (resend) setResending(true);
    else setBusy(true);
    setMessage("");
    setSendError("");
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
      else if (e.field === "email" || e.status === 400) failEmail(e.message);
      else setMessage(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setResending(false);
    }
  }

  const blocked = wait > 0 && email.trim().toLowerCase() === waitFor;

  if (sentTo)
    return (
      <section className="auth-card card flow">
        <div className="flow-step" key="sent">
          <EmailSent
            email={sentTo}
            purpose="reset"
            codeEnabled={codeEnabled}
            next="/passwort"
            saved={false}
            resendIn={wait}
            resent={resent}
            resending={resending}
            error={sendError}
            onResend={() => void sendLink(true)}
            onChangeEmail={() => {
              focusInput.current = true;
              setSentTo("");
            }}
            headingRef={heading}
          />
        </div>
      </section>
    );

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={mode}>
        <span className="icon-tile lime">{mode === "password" ? <LogIn /> : <KeyRound />}</span>
        <h1 ref={heading} tabIndex={-1}>
          {mode === "password" ? "Bei Deal Operator anmelden." : "Passwort vergessen?"}
        </h1>
        <p className="flow-lead">
          {mode === "password"
            ? `Mit E-Mail und Passwort. Du bleibst danach auf diesem Gerät angemeldet.${target ? ` Es geht direkt weiter ${target}.` : ""}`
            : "Kein Problem, auch wenn du noch nie eins festgelegt hast. Wir schicken dir einmal einen Link, danach legst du ein Passwort fest."}
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
        {mode === "link" && <InAppHint codeEnabled={codeEnabled} />}
        <form
          className="flow-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === "password" ? signIn() : sendLink(false));
          }}
        >
          <div className="flow-field" data-invalid={emailError ? "" : undefined}>
            <label htmlFor={`${id}-email`}>E-Mail</label>
            <input
              id={`${id}-email`}
              ref={emailInput}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={mode === "password" ? "next" : "send"}
              maxLength={254}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError("");
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `${id}-error` : undefined}
            />
            {emailError && (
              <p id={`${id}-error`} className="flow-field-error">
                {emailError}
              </p>
            )}
          </div>
          {mode === "password" && (
            <PasswordField
              value={password}
              onChange={(value) => {
                setPassword(value);
                setPasswordError("");
              }}
              error={passwordError}
              autoComplete="current-password"
              inputRef={passwordInput}
            />
          )}
          <button
            className="btn primary full"
            disabled={!ready || busy || (mode === "link" && blocked)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : mode === "password" ? (
              <LogIn size={18} />
            ) : (
              <Mail size={18} />
            )}
            {mode === "password" ? "Anmelden" : "Link zum Passwort senden"}
            {mode === "link" && blocked && (
              <span className="flow-wait">
                {" "}
                ({Math.floor(wait / 60)}:{String(wait % 60).padStart(2, "0")})
              </span>
            )}
          </button>
        </form>
        <div className="flow-actions">
          <button
            type="button"
            className="flow-link"
            onClick={() => {
              setMode(mode === "password" ? "link" : "password");
              setMessage("");
              setPasswordError("");
            }}
          >
            {mode === "password" ? "Passwort vergessen oder noch keins?" : "Zurück zur Anmeldung mit Passwort"}
          </button>
        </div>
        <p className="flow-signin">
          Noch kein Konto? <Link href={startHref}>Kostenfrei registrieren</Link>
        </p>
      </div>
    </section>
  );
}
