"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, LoaderCircle, LogIn, Mail } from "lucide-react";
import {
  call,
  EmailSent,
  InAppHint,
  linkErrorText,
  PasswordField,
  RequestError,
  type SentPurpose,
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
 * Passwort-Manager kann beides speichern. Eine Mail gibt es nur, wenn die
 * Adresse noch nicht bestätigt ist (Code, danach geht es mit demselben
 * Passwort weiter) oder das Passwort vergessen wurde (Code und neues
 * Passwort). Mit ownMail kommen diese Mails von der App selbst; sonst gibt es
 * einen Anmeldelink von Supabase. Das ursprüngliche Ziel (next) bleibt.
 */
export default function AuthForm({
  ready,
  next,
  error,
  codeEnabled,
  ownMail = false,
  confirmed = false,
}: {
  ready: boolean;
  next: string;
  error: string;
  codeEnabled: boolean;
  /** Mails mit Code kommen von der App selbst (server/email-code.ts). */
  ownMail?: boolean;
  /** Rückkehr nach bestätigter Adresse (?bestaetigt=1). */
  confirmed?: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  // Wofür die Mail ging: Anmeldelink (Supabase), neues Passwort per Code
  // oder Bestätigung der Adresse beim Anmelden.
  const [sentFor, setSentFor] = useState<SentPurpose>("reset");
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
      const data = await call<{ next?: string; confirm?: boolean; resendAfter?: number }>("/api/auth", {
        action: "signin",
        email: address,
        password,
        next,
      });
      // Passwort stimmt, die Adresse ist aber noch nicht bestätigt: Code aus
      // der Mail eingeben, danach geht es mit demselben Passwort weiter.
      if (data.confirm) {
        setSentFor("signin");
        setWaitFor(address);
        setWait(data.resendAfter || 60);
        setSentTo(address);
        inFlight.current = false;
        setBusy(false);
        return;
      }
      // Vollständiger Seitenwechsel: der Passwort-Manager bietet danach das
      // Speichern an, und die neue Sitzung gilt überall.
      window.location.assign(data.next!);
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

  /**
   * Nach dem Code (oder erneut senden): noch einmal mit dem Passwort aus
   * diesem Formular anmelden. Ist die Adresse noch offen, schickt der Server
   * eine neue Mail mit Code.
   */
  async function signInAgain(resend: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (resend) setResending(true);
    setSendError("");
    setResent(false);
    try {
      const data = await call<{ next?: string; confirm?: boolean; resendAfter?: number }>("/api/auth", {
        action: "signin",
        email: sentTo,
        password,
        next,
      });
      if (data.next) {
        window.location.assign(data.next);
        return;
      }
      setWaitFor(sentTo);
      setWait(data.resendAfter || 60);
      if (resend) setResent(true);
      else setSendError("Deine Adresse ist noch nicht bestätigt. Gib den Code aus der neuesten Mail ein.");
    } catch (err) {
      const e = err as RequestError;
      if (e.retryAfter) {
        setWaitFor(sentTo);
        setWait(e.retryAfter);
      }
      setSendError(e.message);
    } finally {
      inFlight.current = false;
      setResending(false);
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
      const data = await call<{ resendAfter?: number; newPassword?: boolean }>("/api/auth", {
        email: address,
        next,
      });
      setSentFor(data.newPassword ? "newPassword" : "reset");
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
            purpose={sentFor}
            codeEnabled={codeEnabled || sentFor !== "reset"}
            next={sentFor === "reset" ? "/passwort" : next}
            saved={false}
            resendIn={wait}
            resent={resent}
            resending={resending}
            error={sendError}
            onResend={() => void (sentFor === "signin" ? signInAgain(true) : sendLink(true))}
            onConfirmed={sentFor === "signin" ? () => signInAgain(false) : undefined}
            onChangeEmail={() => {
              focusInput.current = true;
              setSentTo("");
            }}
            headingRef={heading}
            waiting={
              sentFor === "signin" ? (
                <p className="flow-body">
                  Deine Adresse ist noch nicht bestätigt. Gib den Code aus der Mail ein oder tipp auf den
                  Link darin. Danach bist du mit deinem Passwort direkt angemeldet.{" "}
                  <button type="button" className="flow-link" onClick={() => void signInAgain(false)}>
                    Schon per Link bestätigt? Jetzt anmelden
                  </button>
                </p>
              ) : undefined
            }
          />
        </div>
      </section>
    );

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={mode}>
        <h1 ref={heading} tabIndex={-1}>
          {mode === "password" ? "Bei Deal Operator anmelden." : "Passwort vergessen?"}
        </h1>
        <p className="flow-lead">
          {mode === "password"
            ? `Mit E-Mail und Passwort. Du bleibst danach auf diesem Gerät angemeldet.${target ? ` Es geht direkt weiter ${target}.` : ""}`
            : ownMail
              ? "Kein Problem, auch wenn du noch nie eins festgelegt hast. Wir schicken dir einen Code per Mail, damit legst du ein neues Passwort fest."
              : "Kein Problem, auch wenn du noch nie eins festgelegt hast. Wir schicken dir einmal einen Link, danach legst du ein Passwort fest."}
        </p>
        {confirmed && mode === "password" && !message && (
          <p className="flow-waiting">
            <CircleCheck size={18} aria-hidden="true" />
            <span>E-Mail bestätigt. Melde dich jetzt mit deinem Passwort an.</span>
          </p>
        )}
        {!ready && (
          <div className="flow-notice">
            <strong>Die Anmeldung öffnet in Kürze.</strong>
            <p>
              Die öffentliche Rangliste zeigt schon jetzt den gemeldeten Stand.
            </p>
          </div>
        )}
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        {mode === "link" && <InAppHint codeEnabled={codeEnabled || ownMail} />}
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
            {mode === "password" ? "Anmelden" : ownMail ? "Code senden" : "Link zum Passwort senden"}
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
            {mode === "password" ? "Passwort vergessen?" : "Zurück zur Anmeldung mit Passwort"}
          </button>
        </div>
        <p className="flow-signin">
          Noch kein Konto? <Link href={startHref}>Kostenfrei registrieren</Link>
        </p>
      </div>
    </section>
  );
}
