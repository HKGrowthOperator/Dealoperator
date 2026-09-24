"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  MailCheck,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  DEFAULT_PHONE_COUNTRY,
  normalisePhone,
  PHONE_COUNTRIES,
} from "@/lib/phone";
import "../flow.css";

/*
 * Bausteine für Start, Anmeldung und Profilübernahme. Ein Ort für Suche,
 * Kontaktfelder, Fortschritt und die Bestätigungsansicht, damit alle Wege
 * gleich aussehen und sich gleich verhalten.
 */

export type Profile = { id: string; name: string; company: string; role: string };

/** Gemeinsame Teamprofile tragen ihre Kennzeichnung in der Rolle. */
export const isTeamProfile = (p: Profile | null | undefined) =>
  /^team\b/i.test(p?.role || "");
export const profileMeta = (p: Profile) =>
  [p.company, p.role].filter(Boolean).join(" · ");

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** GET ohne body, POST mit body. Fehler kommen mit Feld und Wartezeit zurück. */
export async function call<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      url,
      body === undefined
        ? { cache: "no-store", signal }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
          },
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new RequestError(
      "Keine Verbindung. Prüfe dein Netz und versuche es noch einmal.",
      0,
    );
  }
  let data: Record<string, unknown> = {};
  try {
    data = await response.json();
  } catch {
    /* leere Antwort */
  }
  if (!response.ok)
    throw new RequestError(
      typeof data.error === "string"
        ? data.error
        : "Das hat gerade nicht geklappt. Bitte versuche es noch einmal.",
      response.status,
      typeof data.field === "string" ? data.field : undefined,
      typeof data.retryAfter === "number" ? data.retryAfter : undefined,
    );
  return data as T;
}

/** Überschrift, die bei jedem Schrittwechsel den Fokus bekommt (Screenreader, Tastatur). */
export function useStepHeading(step: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [step]);
  return ref;
}

/** Sekunden bis zum nächsten erlaubten Versand, zählt selbst herunter. */
export function useCountdown(initial = 0): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, setLeft];
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function FlowProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flow-progress">
      <p>
        <span>
          Schritt {current + 1} von {steps.length}
        </span>{" "}
        · {steps[current]}
      </p>
      <ol aria-hidden="true">
        {steps.map((label, index) => (
          <li
            key={label}
            data-state={index < current ? "done" : index === current ? "current" : "open"}
          />
        ))}
      </ol>
    </div>
  );
}

export function ProfileCard({
  profile,
  label = "Ausgewähltes Profil",
  onChange,
}: {
  profile: Profile;
  label?: string;
  onChange?: () => void;
}) {
  return (
    <div className="flow-profile">
      <div>
        <span>{isTeamProfile(profile) ? "Gemeinsames Teamprofil" : label}</span>
        <strong>{profile.name}</strong>
        {profileMeta(profile) && <small>{profileMeta(profile)}</small>}
      </div>
      {onChange && (
        <button type="button" className="flow-link" onClick={onChange}>
          Anderes Profil wählen
        </button>
      )}
    </div>
  );
}

type SearchState = "idle" | "loading" | "done" | "error";

/**
 * Profilsuche mit Lade-, Fehler- und Leerzustand. Ältere Antworten
 * überschreiben nie eine neuere Eingabe: jede Suche bricht die vorige ab und
 * zählt mit. Ein technischer Fehler erscheint nie als „kein Profil gefunden“.
 */
export function ProfileSearch({
  query,
  onQuery,
  onPick,
  notFound,
}: {
  query: string;
  onQuery: (value: string) => void;
  onPick: (profile: Profile) => void;
  notFound: (query: string, hadResults: boolean) => React.ReactNode;
}) {
  const id = useId();
  const [state, setState] = useState<SearchState>("idle");
  const [results, setResults] = useState<Profile[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [showMissing, setShowMissing] = useState(false);
  // Wofür das angezeigte Ergebnis gilt. „Nicht gefunden“ steht nur da, wenn
  // genau die aktuelle Eingabe gesucht wurde.
  const [searchedFor, setSearchedFor] = useState("");
  const latest = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    const run = ++latest.current;
    const controller = new AbortController();
    const q = query.trim();
    const timer = setTimeout(
      async () => {
        if (q.length < 2) {
          setResults([]);
          setState("idle");
          return;
        }
        setState("loading");
        setShowMissing(false);
        try {
          // POST: der gesuchte Name steht so in keiner Adresse und keinem Log.
          const data = await call<{ ready?: boolean; profiles?: Profile[] }>(
            "/api/onboarding",
            { action: "search", q },
            controller.signal,
          );
          if (run !== latest.current) return;
          // Ohne Datenbank ist „nichts gefunden“ keine ehrliche Antwort.
          if (data.ready === false) throw new Error("not ready");
          setResults(data.profiles || []);
          setSearchedFor(q);
          setState("done");
        } catch {
          if (controller.signal.aborted || run !== latest.current) return;
          setState("error");
        }
      },
      q.length < 2 ? 0 : 280,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);

  const status =
    state === "loading"
      ? "Suche läuft …"
      : state === "done" && results.length > 0
        ? results.length === 1
          ? "1 passendes Profil"
          : `${results.length} passende Profile`
        : trimmed.length < 2
          ? "Mindestens zwei Buchstaben, zum Beispiel dein Vorname."
          : "";

  return (
    <div className="flow-search">
      <div className="flow-field">
        <label htmlFor={`${id}-q`}>Dein Name im Ranking</label>
        <div className="flow-search-input">
          <Search size={18} aria-hidden="true" />
          <input
            id={`${id}-q`}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={80}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-describedby={`${id}-status`}
            placeholder="Vor- oder Nachname"
          />
          {state === "loading" && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
        </div>
        <p id={`${id}-status`} className="flow-note" aria-live="polite">
          {status}
        </p>
      </div>

      {state === "error" && (
        <div className="flow-alert" role="alert">
          <p>
            Die Suche klappt gerade nicht. Das heißt nicht, dass es dein Profil
            nicht gibt.
          </p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshCw size={16} /> Erneut suchen
          </button>
        </div>
      )}

      {state === "done" && results.length > 0 && (
        <>
          <ul className="flow-results" aria-label="Gefundene Profile">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p)}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {isTeamProfile(p) ? "Gemeinsames Teamprofil" : profileMeta(p) || "Vorbereitetes Profil"}
                    </small>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {!showMissing ? (
            <button type="button" className="flow-link" onClick={() => setShowMissing(true)}>
              Mein Profil ist nicht dabei
            </button>
          ) : (
            notFound(trimmed, true)
          )}
        </>
      )}

      {state === "done" && results.length === 0 && searchedFor === trimmed && notFound(trimmed, false)}
    </div>
  );
}

export type Contact = {
  fullName: string;
  email: string;
  phone: string;
  phoneCountry: string;
  hint: string;
};
export type ContactField = keyof Contact;
export type FieldErrors = Partial<Record<ContactField, string>>;
export const EMPTY_CONTACT: Contact = {
  fullName: "",
  email: "",
  phone: "",
  phoneCountry: DEFAULT_PHONE_COUNTRY,
  hint: "",
};
const FIELD_ORDER: ContactField[] = ["fullName", "email", "phone", "hint"];

/** Dieselben Regeln wie auf dem Server, damit Fehler sofort am Feld stehen. */
export function checkContact(value: Contact, needEmail = true): FieldErrors {
  const errors: FieldErrors = {};
  const name = value.fullName.trim();
  if (!name) errors.fullName = "Bitte gib deinen Vor- und Nachnamen an.";
  else if (name.length < 3 || !/\S\s+\S/.test(name))
    errors.fullName = "Bitte gib Vor- und Nachnamen an.";
  if (needEmail) {
    const email = value.email.trim();
    if (!email) errors.email = "Bitte gib deine E-Mail-Adresse an.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      errors.email = "Bitte prüfe deine E-Mail-Adresse.";
  }
  const phone = normalisePhone(value.phone, value.phoneCountry);
  if (!phone.ok) errors.phone = phone.reason;
  return errors;
}

/** Fokus auf das erste fehlerhafte Feld; der Browser scrollt es dabei sichtbar. */
export function focusFirstError(
  errors: FieldErrors,
  fields: React.RefObject<Partial<Record<ContactField, HTMLElement | null>>>,
) {
  const first = FIELD_ORDER.find((f) => errors[f]);
  if (!first) return;
  const el = fields.current?.[first];
  el?.focus();
  el?.scrollIntoView?.({ block: "center" });
}

const PHONE_EXAMPLE: Record<string, string> = {
  DE: "0170 1234567",
  AT: "0664 1234567",
  CH: "079 123 45 67",
};

/**
 * Name, E-Mail, Telefon mit Ländervorwahl und optional ein Hinweis fürs Team.
 * Autofill und passende Handytastaturen sind gesetzt; Fehler stehen direkt am
 * Feld und bleiben mit der Eingabe verbunden (aria-describedby).
 */
export function ContactFields({
  value,
  onChange,
  errors,
  fields,
  email = "edit",
  hint = "none",
  nameSuggested = false,
  afterEmail,
}: {
  /** Zusätzliches Feld direkt nach der E-Mail (Passwort bei der Registrierung). */
  afterEmail?: React.ReactNode;
  value: Contact;
  onChange: (patch: Partial<Contact>) => void;
  errors: FieldErrors;
  fields: React.RefObject<Partial<Record<ContactField, HTMLElement | null>>>;
  email?: "edit" | "hidden";
  /** none: kein Hinweisfeld; toggle: hinter einem Knopf; open: direkt sichtbar. */
  hint?: "none" | "toggle" | "open";
  nameSuggested?: boolean;
}) {
  const id = useId();
  const [hintOpen, setHintOpen] = useState(hint === "open" || Boolean(value.hint));
  const register = (field: ContactField) => (el: HTMLElement | null) => {
    if (fields.current) fields.current[field] = el;
  };
  const described = (field: ContactField, note?: boolean) =>
    errors[field] ? `${id}-${field}-error` : note ? `${id}-${field}-note` : undefined;
  const oneWord = value.fullName.trim() !== "" && !/\S\s+\S/.test(value.fullName.trim());
  const country = PHONE_COUNTRIES.find((c) => c.code === value.phoneCountry);

  return (
    <>
      <div className="flow-field" data-invalid={errors.fullName ? "" : undefined}>
        <label htmlFor={`${id}-name`}>Vor- und Nachname</label>
        <input
          id={`${id}-name`}
          ref={register("fullName")}
          name="name"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          maxLength={120}
          value={value.fullName}
          onChange={(e) => onChange({ fullName: e.target.value })}
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={described("fullName", nameSuggested || oneWord)}
        />
        {errors.fullName ? (
          <p id={`${id}-fullName-error`} className="flow-field-error">
            {errors.fullName}
          </p>
        ) : oneWord ? (
          <p id={`${id}-fullName-note`} className="flow-note">
            Bitte ergänze deinen vollständigen Namen, damit das Team dich
            zuordnen kann.
          </p>
        ) : nameSuggested ? (
          <p id={`${id}-fullName-note`} className="flow-note">
            Vorschlag aus dem Profil. Bitte so, wie du wirklich heißt.
          </p>
        ) : null}
      </div>

      {email === "edit" && (
        <div className="flow-field" data-invalid={errors.email ? "" : undefined}>
          <label htmlFor={`${id}-email`}>E-Mail</label>
          <input
            id={`${id}-email`}
            ref={register("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            maxLength={254}
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={described("email")}
          />
          {errors.email && (
            <p id={`${id}-email-error`} className="flow-field-error">
              {errors.email}
            </p>
          )}
        </div>
      )}
      {afterEmail}

      <div className="flow-field" data-invalid={errors.phone ? "" : undefined}>
        <label htmlFor={`${id}-phone`}>Telefon</label>
        <div className="flow-phone">
          <select
            aria-label="Ländervorwahl"
            value={value.phoneCountry}
            onChange={(e) => onChange({ phoneCountry: e.target.value })}
          >
            {PHONE_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} +{c.dial}
              </option>
            ))}
          </select>
          <input
            id={`${id}-phone`}
            ref={register("phone")}
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint={hint === "none" ? "done" : "next"}
            maxLength={40}
            placeholder={PHONE_EXAMPLE[value.phoneCountry] || ""}
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={described("phone", true)}
          />
        </div>
        {errors.phone ? (
          <p id={`${id}-phone-error`} className="flow-field-error">
            {errors.phone}
          </p>
        ) : (
          country?.trunk && (
            <p id={`${id}-phone-note`} className="flow-note">
              Mit oder ohne führende 0.
            </p>
          )
        )}
      </div>

      {hint !== "none" &&
        (hintOpen ? (
          <div className="flow-field">
            <label htmlFor={`${id}-hint`}>Hinweis für das Team (optional)</label>
            <textarea
              id={`${id}-hint`}
              ref={register("hint")}
              rows={2}
              maxLength={300}
              value={value.hint}
              onChange={(e) => onChange({ hint: e.target.value })}
              placeholder="Zum Beispiel dein Name im Gruppenchat oder dein Unternehmen"
            />
          </div>
        ) : (
          <button type="button" className="flow-link flow-add" onClick={() => setHintOpen(true)}>
            <Plus size={16} aria-hidden="true" /> Hinweis für das Team hinzufügen
          </button>
        ))}
    </>
  );
}

/**
 * Passwortfeld mit Anzeigen/Verbergen. autoComplete steuert den
 * Passwort-Manager: „new-password“ beim Festlegen (er schlägt ein starkes
 * vor und speichert es), „current-password“ beim Anmelden.
 */
export function PasswordField({
  value,
  onChange,
  error,
  autoComplete,
  inputRef,
  label = "Passwort",
  note,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete: "new-password" | "current-password";
  inputRef?: React.Ref<HTMLInputElement>;
  label?: string;
  note?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const described = error ? `${id}-error` : note ? `${id}-note` : undefined;
  return (
    <div className="flow-field" data-invalid={error ? "" : undefined}>
      <label htmlFor={`${id}-pw`}>{label}</label>
      <div className="flow-password">
        <input
          id={`${id}-pw`}
          ref={inputRef}
          name="password"
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
        />
        <button
          type="button"
          className="flow-reveal"
          aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="flow-field-error">
          {error}
        </p>
      ) : note ? (
        <p id={`${id}-note`} className="flow-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Dieselbe Mindestregel wie auf dem Server. */
export function checkPassword(value: string) {
  if (!value) return "Bitte lege ein Passwort fest.";
  if (value.length < 8) return "Bitte nimm mindestens 8 Zeichen.";
  if (new TextEncoder().encode(value).length > 72) return "Bitte nimm höchstens 72 Zeichen.";
  return "";
}

export function PrivacyNote() {
  return (
    <p className="flow-privacy">
      <Lock size={15} aria-hidden="true" />
      E-Mail und Telefonnummer sind nur für dich und das Team sichtbar.
    </p>
  );
}

/** Messenger-Apps öffnen Links in einem eigenen Browser (Instagram, LinkedIn …). */
export function inAppBrowser() {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|Instagram|LinkedInApp|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|GSA\/|; wv\)/i.test(
    navigator.userAgent,
  );
}

/**
 * Hinweis vor dem Versand, solange die Mail nur einen Link für denselben
 * Browser enthält: App-Browser öffnen den Maillink meist in Safari oder
 * Chrome, dort fehlt die Anfrage. Mit Code in der Mail ist das kein Problem.
 */
export function InAppHint({ codeEnabled }: { codeEnabled: boolean }) {
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setInApp(inAppBrowser()), 0);
    return () => clearTimeout(timer);
  }, []);
  if (codeEnabled || !inApp) return null;
  return (
    <div className="flow-notice">
      <strong>Du bist in einem App-Browser.</strong>
      <p>
        Der Link aus der Mail öffnet sich meist in Safari oder Chrome und klappt
        nur in dem Browser, in dem du ihn anforderst. Öffne diese Seite deshalb
        zuerst dort, zum Beispiel über „Im Browser öffnen“.
      </p>
    </div>
  );
}

export type SentPurpose = "new" | "claim" | "assign" | "signin" | "reset";

const NEXT_STEP: Record<SentPurpose, (profile?: string) => string> = {
  new: () => "Danach legst du dein Profil an und trägst deinen ersten Tag ein.",
  claim: (profile) =>
    `Danach prüft das Team deine Übernahme${profile ? ` von „${profile}“` : ""}. Freigeben kann nur das Team.`,
  assign: () =>
    "Danach sucht das Team dein Profil heraus und ordnet es dir zu. Den Stand siehst du nach der Bestätigung.",
  signin: () => "Danach bist du angemeldet und landest direkt dort, wo du hinwolltest.",
  reset: () =>
    "Danach legst du ein Passwort fest. Ab dann meldest du dich mit E-Mail und Passwort an, ganz ohne Mail.",
};

/**
 * Nach dem Versand: Adresse, Link oder Code, Erneut senden mit der echten
 * Wartezeit, Adresse ändern. „Gespeichert“ steht nur da, wenn die Angaben
 * serverseitig wiederherstellbar sind (saved).
 */
export function EmailSent({
  email,
  purpose,
  profileName,
  codeEnabled,
  next,
  saved,
  resendIn,
  resent,
  resending,
  error,
  onResend,
  onChangeEmail,
  onRestart,
  headingRef,
  waiting,
}: {
  /** Hinweis oder Formular, solange auf die Bestätigung gewartet wird. */
  waiting?: React.ReactNode;
  email: string;
  purpose: SentPurpose;
  profileName?: string;
  codeEnabled: boolean;
  next: string;
  saved: boolean;
  resendIn: number;
  resent: boolean;
  resending: boolean;
  error: string;
  onResend: () => void;
  onChangeEmail: () => void;
  /** Nur bei wiederhergestelltem Stand: anderen Weg wählen. */
  onRestart?: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) {
      setCodeError("Bitte gib den Code aus der Mail vollständig ein.");
      codeRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setChecking(true);
    setCodeError("");
    try {
      const data = await call<{ next: string }>("/api/auth", {
        action: "verify",
        email,
        code: digits,
        next,
      });
      window.location.assign(data.next);
    } catch (e) {
      setCodeError((e as Error).message);
      setChecking(false);
      inFlight.current = false;
      codeRef.current?.focus();
    }
  }

  return (
    <>
      <span className="icon-tile lime">
        <MailCheck />
      </span>
      <h1 ref={headingRef} tabIndex={-1}>
        Bestätige deine E-Mail.
      </h1>
      <p className="flow-lead">
        Wir haben dir eine Mail an <strong className="flow-address">{email}</strong>{" "}
        geschickt.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {waiting ?? (
        <p className="flow-body">
          {codeEnabled
            ? "Tipp auf den Link in der Mail oder gib den Code aus der Mail hier ein. Beides klappt auch, wenn du die Mail auf einem anderen Gerät öffnest."
            : "Tipp auf den Link in der Mail. Öffne ihn in diesem Browser; in einem anderen lässt er sich aus Sicherheitsgründen nicht einlösen."}
        </p>
      )}

      {codeEnabled && (
        <form className="flow-code" onSubmit={verify} noValidate>
          <div className="flow-field" data-invalid={codeError ? "" : undefined}>
            <label htmlFor={`${id}-code`}>Code aus der Mail</label>
            <input
              id={`${id}-code`}
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              enterKeyHint="go"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? `${id}-code-error` : undefined}
            />
            {codeError && (
              <p id={`${id}-code-error`} className="flow-field-error" role="alert">
                {codeError}
              </p>
            )}
          </div>
          <button className="btn primary full" disabled={checking}>
            {checking && <LoaderCircle className="spin" size={18} />}
            Code bestätigen
          </button>
        </form>
      )}

      <div className="flow-notice">
        <strong>Wie es weitergeht</strong>
        <p>{NEXT_STEP[purpose](profileName)}</p>
        {saved && (
          <p>Deine Angaben sind gespeichert. Du musst sie nicht erneut eingeben.</p>
        )}
      </div>

      <p className="flow-status" aria-live="polite">
        {resent ? "Wir haben dir eine neue Mail geschickt. Nur die neueste Mail gilt." : ""}
      </p>

      <div className="flow-actions">
        <button
          type="button"
          className="btn secondary full"
          onClick={onResend}
          disabled={resendIn > 0 || resending}
          aria-describedby={resendIn > 0 ? `${id}-wait` : undefined}
        >
          {resending ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={16} />}
          Erneut senden
          {resendIn > 0 && <span className="flow-wait"> ({clock(resendIn)})</span>}
        </button>
        {resendIn > 0 && (
          <span id={`${id}-wait`} className="sr-only">
            Erneutes Senden ist in {resendIn} Sekunden möglich.
          </span>
        )}
        <button type="button" className="flow-link" onClick={onChangeEmail}>
          E-Mail-Adresse ändern
        </button>
        {onRestart && (
          <button type="button" className="flow-link" onClick={onRestart}>
            Anderen Weg wählen
          </button>
        )}
      </div>
      <p className="flow-small">
        Keine Mail da? Schau auch im Spam-Ordner nach.{" "}
        {codeEnabled ? "Link und Code gelten nur einmal." : "Der Link gilt nur einmal."}
      </p>
    </>
  );
}

/** Kleine Zeile unter der Wegwahl: bestehende Konten melden sich nur an. */
export function SignInLine({ next }: { next?: string }) {
  return (
    <p className="flow-signin">
      Schon registriert?{" "}
      <Link href={next ? `/anmelden?next=${encodeURIComponent(next)}` : "/anmelden"}>
        Anmelden
      </Link>
    </p>
  );
}

/**
 * Texte zu den Rücksprung-Fehlern aus /auth/callback. Supabase meldet einen
 * abgelaufenen und einen bereits eingelösten Link mit demselben Code, deshalb
 * nennt „abgelaufen“ beides.
 */
export function linkErrorText(reason: string, codeEnabled: boolean) {
  switch (reason) {
    case "":
      return "";
    case "abgelaufen":
      return "Dieser Link ist nicht mehr gültig. Links aus der Mail gelten nur einmal und nur für begrenzte Zeit, und eine neue Mail ersetzt die vorige. Fordere hier eine neue Mail an.";
    case "verwendet":
      return "Dieser Link wurde schon verwendet. Fordere einfach eine neue Mail an.";
    case "browser":
      return codeEnabled
        ? "Dieser Link gehört zu einem anderen Browser. Fordere hier eine neue Mail an; mit dem Code aus der Mail klappt es auch in diesem Browser."
        : "Dieser Link wurde in einem anderen Browser geöffnet als dem, in dem du ihn angefordert hast. Fordere hier eine neue Mail an und öffne den Link in diesem Browser.";
    case "technik":
      return "Die Anmeldung ist gerade technisch nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal.";
    default:
      return "Dieser Link ist unvollständig. Fordere sicherheitshalber eine neue Mail an.";
  }
}

/**
 * Supabase hängt Fehler manchmal als #error_code=… an. Der Server sieht den
 * Teil nach # nicht; hier wird er gelesen und aus der Adresse entfernt,
 * ebenso ein ?fehler=…, damit Neuladen die Meldung nicht wiederholt.
 */
export function takeLinkError(): string {
  if (typeof window === "undefined") return "";
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const url = new URL(window.location.href);
  const fromHash = hash.get("error_code")
    ? /expired/.test(hash.get("error_code") || "")
      ? "abgelaufen"
      : "link"
    : "";
  const fromQuery = url.searchParams.get("fehler") || "";
  if (fromHash || fromQuery || window.location.hash) {
    url.searchParams.delete("fehler");
    url.hash = "";
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  return fromHash || fromQuery.slice(0, 20);
}
