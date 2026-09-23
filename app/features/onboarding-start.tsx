"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleCheck,
  LoaderCircle,
  LogIn,
  Mail,
  Search,
  Sparkles,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { splitPhone } from "@/lib/phone";
import {
  call,
  checkContact,
  checkPassword,
  ContactFields,
  EMPTY_CONTACT,
  EmailSent,
  FlowProgress,
  focusFirstError,
  InAppHint,
  isTeamProfile,
  linkErrorText,
  PasswordField,
  PrivacyNote,
  ProfileCard,
  ProfileSearch,
  RequestError,
  SignInLine,
  takeLinkError,
  useCountdown,
  useStepHeading,
  type Contact,
  type ContactField,
  type FieldErrors,
  type Profile,
} from "./flow-parts";

type Mode = "new" | "claim" | "assign";
type Step = "choice" | "taken" | "search" | "contact" | "sent" | "confirmed";

export type PendingStart = {
  kind: "new" | "claim";
  profile: Profile | null;
  profileTaken: boolean;
  takenName: string;
  /** Nach dem letzten Absenden wirklich an Supabase übergeben. */
  mailSent: boolean;
  email: string;
  fullName: string;
  phone: string;
  hint: string;
  resendIn: number;
};

const STEPS: Record<Mode, string[]> = {
  claim: ["Profil finden", "Deine Angaben", "E-Mail bestätigen", "Prüfung durch das Team"],
  assign: ["Profil suchen", "Deine Angaben", "E-Mail bestätigen", "Zuordnung durch das Team"],
  new: ["Weg wählen", "Deine Angaben", "E-Mail bestätigen", "Profil anlegen"],
};
const STEP_INDEX: Partial<Record<Step, number>> = { search: 0, contact: 1, sent: 2 };
const WEG: Record<Mode, string> = { new: "neu", claim: "profil", assign: "team" };
const MODE_OF: Record<string, Mode> = { neu: "new", profil: "claim", team: "assign" };
const SCHRITT: Partial<Record<Step, string>> = {
  search: "suche",
  contact: "angaben",
  sent: "bestaetigen",
};
const STEP_OF: Record<string, Step> = {
  suche: "search",
  angaben: "contact",
  bestaetigen: "sent",
};
const FIELDS: ContactField[] = ["fullName", "email", "phone", "hint"];
const DRAFT = "do-start-entwurf";
const twoWords = (v: string) => /\S\s+\S/.test(v.trim());

function contactFrom(pending: PendingStart): Contact {
  const phone = splitPhone(pending.phone);
  return {
    fullName: pending.fullName,
    email: pending.email,
    phone: phone.national,
    phoneCountry: phone.country,
    hint: pending.hint,
  };
}

/**
 * Einstieg unter /starten: zwei gleichwertige Wege, Profilsuche, ein kurzes
 * Formular und die Bestätigung per Mail. Der Stand hängt an der Adresse
 * (weg, schritt, profil) und, für die Eingaben, am Tab (sessionStorage);
 * nach dem Versand stellt der Server die Angaben über das httpOnly-Cookie
 * wieder her. Kontaktdaten stehen nie in der Adresse.
 */
export default function OnboardingStart({
  ready,
  codeEnabled,
  preselected,
  taken,
  invite,
  linkError,
  problem = "",
  needsInvite = "",
  pending,
  initialWeg = "",
  initialSchritt = "",
  confirmedElsewhere = false,
}: {
  /** Bestätigungslink auf einem anderen Gerät geöffnet (?bestaetigt=1). */
  confirmedElsewhere?: boolean;
  ready: boolean;
  codeEnabled: boolean;
  preselected: Profile | null;
  taken: { id: string; name: string } | null;
  invite: string;
  linkError: string;
  problem?: string;
  needsInvite?: string;
  pending: PendingStart | null;
  /** weg=neu|profil|team aus der Adresse, damit Neuladen im selben Weg bleibt. */
  initialWeg?: string;
  /** schritt=angaben: Neuladen nach „E-Mail-Adresse ändern“ bleibt im Formular. */
  initialSchritt?: string;
}) {
  const fromPending = pending && (linkError || !preselected || pending.profile?.id === preselected.id);
  const urlMode = MODE_OF[initialWeg];
  const initialMode: Mode | null = fromPending
    ? pending.kind === "new"
      ? "new"
      : pending.profile
        ? "claim"
        : "assign"
    : preselected
      ? "claim"
      : (urlMode ?? null);
  // Ohne belegten Versand keine Bestätigungsansicht: dann steht das Formular
  // mit den gespeicherten Angaben da.
  const initialStep: Step = confirmedElsewhere && !pending
    ? "confirmed"
    : fromPending
    ? pending.profileTaken
      ? "choice"
      : pending.mailSent && initialSchritt !== "angaben"
        ? "sent"
        : "contact"
    : preselected
      ? "contact"
      : taken
        ? "taken"
        : initialMode === "claim"
          ? "search"
          : initialMode
            ? "contact"
            : "choice";

  const [mode, setMode] = useState<Mode | null>(initialMode);
  const [step, setStep] = useState<Step>(initialStep);
  const [selected, setSelected] = useState<Profile | null>(
    fromPending ? pending.profile : preselected,
  );
  const [query, setQuery] = useState("");
  const [contact, setContact] = useState<Contact>(() =>
    fromPending
      ? contactFrom(pending)
      : preselected && !isTeamProfile(preselected)
        ? { ...EMPTY_CONTACT, fullName: preselected.name }
        : EMPTY_CONTACT,
  );
  const [suggested, setSuggested] = useState(Boolean(!fromPending && preselected));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState(
    fromPending
      ? pending.profileTaken
        ? `„${pending.takenName}“ wurde inzwischen einem anderen Konto zugeordnet. Wenn es dein Profil ist, bitte das Team um Zuordnung; sonst such dein Profil noch einmal.`
        : initialStep === "contact"
          ? [
              linkErrorText(linkError, codeEnabled),
              pending.mailSent
                ? "Deine Angaben sind gespeichert."
                : "Deine Angaben sind gespeichert, die Mail ist aber noch nicht verschickt. Sende sie jetzt ab.",
            ]
              .filter(Boolean)
              .join(" ")
          : ""
      : linkErrorText(linkError, codeEnabled) || problem,
  );
  const [sendError, setSendError] = useState(
    initialStep === "sent" ? linkErrorText(linkError, codeEnabled) : "",
  );
  const [busy, setBusy] = useState(false);
  // Das Passwort bleibt nur im Speicher dieses Tabs: damit meldet sich das
  // Gerät selbst an, sobald die Adresse bestätigt ist, auch wenn die Mail auf
  // dem Handy geöffnet wurde. Nie im Entwurf, nie in der Adresse.
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const passwordRef = useRef("");
  const passwordInput = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const sentBefore = fromPending && pending.mailSent && !pending.profileTaken ? pending : null;
  const [sentTo, setSentTo] = useState(sentBefore ? sentBefore.email : "");
  // Angaben, mit denen zuletzt wirklich versendet wurde. „Erneut senden“ nimmt
  // genau diese, auch wenn im Formular inzwischen etwas anderes steht.
  const [sentWith, setSentWith] = useState<{
    mode: Mode;
    profile: Profile | null;
    contact: Contact;
  } | null>(
    sentBefore && initialMode
      ? { mode: initialMode, profile: sentBefore.profile, contact: contactFrom(sentBefore) }
      : null,
  );
  const [saved, setSaved] = useState(Boolean(fromPending));
  const [waitFor, setWaitFor] = useState(sentBefore ? sentBefore.email : "");
  const [wait, setWait] = useCountdown(sentBefore ? sentBefore.resendIn : 0);
  const inFlight = useRef(false);
  const fields = useRef<Partial<Record<ContactField, HTMLElement | null>>>({});
  const known = useRef<Record<string, Profile>>(
    selected ? { [selected.id]: selected } : {},
  );
  const heading = useStepHeading(`${step}:${mode}`);
  // Nach „E-Mail-Adresse ändern“ gehört der Fokus ins Feld, nicht auf die
  // Überschrift. Läuft nach dem Effekt von useStepHeading.
  const focusNext = useRef<ContactField | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    fields.current[focusNext.current]?.focus();
    focusNext.current = null;
  }, [step]);
  const alertRef = useRef<HTMLParagraphElement>(null);
  // Erst nach dem Zurückholen speichern, sonst überschreibt der leere erste
  // Stand den Entwurf.
  const restored = useRef(false);

  // Adresse beim ersten Laden an den tatsächlichen Stand angleichen, Fehler
  // aus #error_code lesen und einen Entwurf aus diesem Tab zurückholen.
  useEffect(() => {
    const timer = setTimeout(() => {
      const reason = takeLinkError();
      if (reason && reason !== linkError) {
        if (step === "sent") setSendError(linkErrorText(reason, codeEnabled));
        else setMessage(linkErrorText(reason, codeEnabled));
      }
      window.history.replaceState(null, "", urlFor(step, mode, selected));
      restored.current = true;
      if (step !== "contact") return;
      try {
        const draft = JSON.parse(sessionStorage.getItem(DRAFT) || "null") as {
          mode: Mode;
          profileId: string | null;
          contact: Contact;
          suggested: boolean;
        } | null;
        if (draft && draft.mode === mode && draft.profileId === (selected?.id ?? null)) {
          setContact(draft.contact);
          setSuggested(draft.suggested);
        }
      } catch {
        /* kein Speicher verfügbar */
      }
    }, 0);
    return () => clearTimeout(timer);
    // Nur beim ersten Laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zurück und Vor im Browser führen durch die Schritte statt aus dem Start.
  useEffect(() => {
    function onPop() {
      const params = new URLSearchParams(window.location.search);
      const nextMode = MODE_OF[params.get("weg") || ""] ?? null;
      const profile = known.current[params.get("profil") || ""] ?? null;
      let nextStep: Step =
        STEP_OF[params.get("schritt") || ""] ??
        (nextMode ? "search" : taken && params.get("profil") === taken.id ? "taken" : "choice");
      if (nextMode === "claim" && nextStep !== "search" && !profile) nextStep = "search";
      if (nextStep === "sent" && !sentTo) nextStep = "contact";
      setMode(nextMode);
      setSelected(profile);
      setStep(nextStep);
      setErrors({});
      setMessage("");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [sentTo, taken]);

  // Eingaben überleben Neuladen in diesem Tab. Nach dem Versand liegen sie
  // auf dem Server; dann wird der Entwurf gelöscht.
  useEffect(() => {
    if (step !== "contact" || !mode || !restored.current) return;
    try {
      sessionStorage.setItem(
        DRAFT,
        JSON.stringify({ mode, profileId: selected?.id ?? null, contact, suggested }),
      );
    } catch {
      /* kein Speicher verfügbar */
    }
  }, [step, mode, selected, contact, suggested]);

  function urlFor(nextStep: Step, nextMode: Mode | null, profile: Profile | null) {
    const params = new URLSearchParams();
    if (nextMode && nextStep !== "choice" && nextStep !== "taken") {
      params.set("weg", WEG[nextMode]);
      params.set("schritt", SCHRITT[nextStep] || "");
      if (nextMode === "claim" && profile && nextStep !== "search") {
        params.set("profil", profile.id);
        if (invite && profile.id === preselected?.id) params.set("einladung", invite);
      }
    } else if (nextStep === "taken" && taken) {
      params.set("profil", taken.id);
    }
    const query = params.toString();
    return `/starten${query ? `?${query}` : ""}`;
  }

  function go(nextStep: Step, nextMode: Mode | null = mode, profile: Profile | null = selected) {
    if (profile) known.current[profile.id] = profile;
    setStep(nextStep);
    setMode(nextMode);
    setSelected(profile);
    setErrors({});
    window.history.pushState(null, "", urlFor(nextStep, nextMode, profile));
  }

  function patch(value: Partial<Contact>) {
    setContact((c) => ({ ...c, ...value }));
    if (value.fullName !== undefined) setSuggested(false);
    const touched = Object.keys(value) as ContactField[];
    if (touched.some((f) => errors[f]))
      setErrors((e) => {
        const rest = { ...e };
        touched.forEach((f) => delete rest[f]);
        return rest;
      });
  }

  function pick(profile: Profile) {
    setMessage("");
    if (!isTeamProfile(profile) && (!contact.fullName.trim() || suggested)) {
      setContact((c) => ({ ...c, fullName: profile.name }));
      setSuggested(true);
    }
    go("contact", "claim", profile);
  }

  /** Übernimmt, was schon eingegeben wurde, in den nächsten Weg. */
  function switchTo(nextMode: "new" | "assign", searched: string, hint = "") {
    setMessage("");
    setContact((c) => ({
      ...c,
      fullName: c.fullName.trim() && !suggested ? c.fullName : twoWords(searched) ? searched : "",
      hint:
        nextMode === "assign" && !c.hint
          ? hint || (searched ? `Gesucht nach „${searched}“` : "")
          : c.hint,
    }));
    setSuggested(false);
    go("contact", nextMode, null);
  }

  function payload(m: Mode | null, profile: Profile | null, c: Contact) {
    const base = {
      fullName: c.fullName.trim(),
      email: c.email.trim(),
      phone: c.phone.trim(),
      phoneCountry: c.phoneCountry,
    };
    if (m === "new") return { kind: "new", ...base, hint: "" };
    if (m === "assign") return { kind: "claim", ...base, hint: c.hint.trim() };
    return {
      kind: "claim",
      participantId: profile?.id,
      ...(invite && profile?.id === preselected?.id ? { invite } : {}),
      ...base,
      hint: c.hint.trim(),
    };
  }

  async function send(resend: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (resend) setResending(true);
    else setBusy(true);
    setMessage("");
    setSendError("");
    setResent(false);
    const using =
      resend && sentWith ? sentWith : { mode: mode as Mode, profile: selected, contact };
    const email = using.contact.email.trim().toLowerCase();
    try {
      const data = await call<{ resendAfter?: number; signedIn?: boolean; next?: string }>(
        "/api/onboarding",
        resend
          ? { action: "resend" }
          : {
              action: "start",
              value: { ...payload(using.mode, using.profile, using.contact), password },
            },
      );
      if (data.signedIn && data.next) {
        window.location.assign(data.next);
        return;
      }
      passwordRef.current = resend ? passwordRef.current : password;
      setSentWith(using);
      setSentTo(email);
      setSaved(true);
      setWaitFor(email);
      setWait(data.resendAfter || 60);
      try {
        sessionStorage.removeItem(DRAFT);
      } catch {
        /* kein Speicher verfügbar */
      }
      if (resend) setResent(true);
      else go("sent");
    } catch (err) {
      const e = err as RequestError;
      if (e.retryAfter) {
        setWaitFor(email);
        setWait(e.retryAfter);
      }
      if (resend) setSendError(e.message);
      else if (e.field === "password") {
        setPasswordError(e.message);
        passwordInput.current?.focus();
      } else if (e.field && FIELDS.includes(e.field as ContactField)) {
        const next = { [e.field]: e.message } as FieldErrors;
        setErrors(next);
        focusFirstError(next, fields);
      } else {
        setMessage(e.message);
        setTimeout(() => alertRef.current?.focus(), 0);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      setResending(false);
    }
  }

  /** Mit dem Passwort aus diesem Tab (oder dem eben eingetippten) anmelden. */
  async function signIn(secret: string) {
    if (!secret || loggingIn) return false;
    setLoggingIn(true);
    setLoginError("");
    try {
      const data = await call<{ next: string }>("/api/auth", {
        action: "signin",
        email: sentTo,
        password: secret,
        next: "/tagesabschluss",
      });
      window.location.assign(data.next);
      return true;
    } catch (err) {
      const e = err as RequestError;
      // Noch nicht bestätigt: einfach weiter warten.
      if (e.status !== 409) setLoginError(e.message);
      setLoggingIn(false);
      return false;
    }
  }

  // Warten auf die Bestätigung: fragt in Abständen nach, ob die Adresse
  // bestätigt ist (auch auf einem anderen Gerät), und meldet dieses Gerät dann
  // mit dem Passwort an. Supabase wird dabei nur gefragt, wenn es ein Signal gibt.
  useEffect(() => {
    if (step !== "sent") return;
    let stopped = false;
    let running = false;
    async function check() {
      if (stopped || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const { state } = await call<{ state: string }>("/api/onboarding?status=bestaetigung");
        if (!stopped && state === "confirmed") {
          setConfirmed(true);
          if (passwordRef.current) await signIn(passwordRef.current);
        }
      } catch {
        /* nächster Versuch beim nächsten Takt */
      } finally {
        running = false;
      }
    }
    const timer = setInterval(check, 4000);
    const first = setTimeout(check, 1500);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // signIn liest nur Refs und stabile Werte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sentTo]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const found = checkContact(contact);
    const pwError = checkPassword(password);
    setErrors(found);
    setPasswordError(pwError);
    if (Object.keys(found).length) {
      focusFirstError(found, fields);
      return;
    }
    if (pwError) {
      passwordInput.current?.focus();
      return;
    }
    void send(false);
  }

  const blocked = wait > 0 && contact.email.trim().toLowerCase() === waitFor;
  const index = mode ? STEP_INDEX[step] : undefined;

  const missing = (searched: string, hadResults: boolean) => (
    <div className="flow-missing">
      <strong>
        {hadResults
          ? "Dein Profil ist nicht dabei?"
          : `Kein freies Profil zu „${searched}“ gefunden.`}
      </strong>
      <p>
        Versuch eine andere Schreibweise oder nur deinen Vornamen. Hast du dein
        Profil schon übernommen? Dann <Link href="/anmelden">melde dich an</Link>.
      </p>
      <button type="button" className="flow-option" onClick={() => switchTo("assign", searched)}>
        <UsersRound aria-hidden="true" />
        <span>
          <strong>Meine Zahlen müssten schon hier sein</strong>
          <small>Das Team sucht dein Profil heraus und ordnet es dir zu.</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <button type="button" className="flow-option" onClick={() => switchTo("new", searched)}>
        <UserPlus aria-hidden="true" />
        <span>
          <strong>Ich habe noch keine Zahlen</strong>
          <small>Leg ein neues Profil an und trag deinen ersten Tag ein.</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={`${step}:${mode}`}>
        {mode && index !== undefined && <FlowProgress steps={STEPS[mode]} current={index} />}

        {!ready && (
          <div className="flow-notice">
            <strong>Die Anmeldung öffnet in Kürze.</strong>
            <p>Das öffentliche Ranking zeigt schon jetzt den gemeldeten Stand.</p>
          </div>
        )}

        {step === "sent" && mode && (
          <EmailSent
            email={sentTo}
            purpose={sentWith?.mode ?? mode}
            profileName={(sentWith?.profile ?? selected)?.name}
            codeEnabled={codeEnabled}
            next="/tagesabschluss"
            saved={saved}
            resendIn={wait}
            resent={resent}
            resending={resending}
            error={sendError}
            onResend={() => void send(true)}
            onChangeEmail={() => {
              focusNext.current = "email";
              go("contact");
            }}
            onRestart={fromPending ? () => go("choice", null, null) : undefined}
            headingRef={heading}
            waiting={
              confirmed && !passwordRef.current ? (
                <form
                  className="flow-form flow-inline-login"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void signIn(password);
                  }}
                >
                  <p className="flow-waiting">
                    <CircleCheck size={18} aria-hidden="true" />
                    <span>E-Mail bestätigt. Melde dich jetzt mit deinem Passwort an.</span>
                  </p>
                  <input type="hidden" name="email" autoComplete="username" value={sentTo} readOnly />
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    error={loginError}
                    autoComplete="current-password"
                  />
                  <button className="btn primary full" disabled={loggingIn || !password}>
                    {loggingIn && <LoaderCircle className="spin" size={18} />}
                    Anmelden
                  </button>
                </form>
              ) : (
                <>
                  <p className="flow-waiting" aria-live="polite">
                    <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    <span>
                      {confirmed
                        ? "E-Mail bestätigt. Du wirst angemeldet …"
                        : passwordRef.current
                          ? "Tipp auf den Link in der Mail. Das klappt auch auf dem Handy: Sobald du bestätigt hast, geht es hier von selbst weiter."
                          : "Tipp auf den Link in der Mail. Danach meldest du dich mit deinem Passwort an."}
                    </span>
                  </p>
                  {loginError && (
                    <p className="form-error" role="alert">
                      {loginError}
                    </p>
                  )}
                </>
              )
            }
          />
        )}

        {step === "confirmed" && (
          <>
            <span className="icon-tile lime">
              <CircleCheck />
            </span>
            <h1 ref={heading} tabIndex={-1}>
              E-Mail bestätigt.
            </h1>
            <p className="flow-lead">
              Auf dem Gerät, auf dem du dich registriert hast, geht es jetzt von
              selbst weiter. Du willst hier weitermachen? Dann melde dich mit
              E-Mail und Passwort an.
            </p>
            <div className="flow-actions">
              <Link className="btn primary full" href="/anmelden?next=%2Ftagesabschluss">
                Hier anmelden
              </Link>
            </div>
          </>
        )}

        {step === "choice" && (
          <>
            <span className="icon-tile lime">
              <Sparkles />
            </span>
            <h1 ref={heading} tabIndex={-1}>
              Willkommen bei Deal Operator.
            </h1>
            <p className="flow-lead">
              Kostenfrei. Dein Werkzeug für Calling-Tage: Zahlen festhalten,
              Fortschritt sehen, dranbleiben. Als Ergänzung zu deinem Austausch
              bei akquise.de.
            </p>
            {message && (
              <p className="form-error" role="alert" ref={alertRef} tabIndex={-1}>
                {message}
              </p>
            )}
            {needsInvite && (
              <form className="flow-form" action="/starten" method="get">
                <input type="hidden" name="profil" value={needsInvite} />
                <div className="flow-field">
                  <label htmlFor="flow-invite">Code aus deiner Einladung</label>
                  <input id="flow-invite" name="einladung" required maxLength={200} autoComplete="off" />
                </div>
                <button className="btn primary full">Profil mit Einladung öffnen</button>
              </form>
            )}
            <div className="flow-choices">
              <button type="button" onClick={() => go("search", "claim", null)}>
                <Search aria-hidden="true" />
                <span>
                  <strong>Meine Zahlen sind schon hier</strong>
                  <small>Finde dein Profil und führe deine Zahlen weiter.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => go("contact", "new", null)}>
                <UserPlus aria-hidden="true" />
                <span>
                  <strong>Ich starte neu</strong>
                  <small>Lege dein Profil an und trage deinen ersten Tag ein.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
            <SignInLine />
          </>
        )}

        {step === "taken" && taken && (
          <>
            <span className="icon-tile lime">
              <UsersRound />
            </span>
            <h1 ref={heading} tabIndex={-1}>
              Dieses Profil ist schon vergeben.
            </h1>
            <p className="flow-lead">
              „{taken.name}“ ist bereits einem Konto zugeordnet.
            </p>
            <div className="flow-choices">
              <Link className="flow-option" href="/anmelden">
                <LogIn aria-hidden="true" />
                <span>
                  <strong>Das ist mein Profil</strong>
                  <small>Du hast es schon übernommen? Dann melde dich einfach an.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
              <button
                type="button"
                className="flow-option"
                onClick={() =>
                  switchTo("assign", "", `Betrifft das bereits vergebene Profil „${taken.name}“.`)
                }
              >
                <UsersRound aria-hidden="true" />
                <span>
                  <strong>Es ist meins, aber ich habe kein Konto</strong>
                  <small>Das Team klärt die Zuordnung. Es entsteht kein zweites Profil.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="flow-link" onClick={() => go("search", "claim", null)}>
              Anderes Profil suchen
            </button>
          </>
        )}

        {step === "search" && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              Finde dein Profil.
            </h1>
            <p className="flow-lead">
              Such nach dem Namen, unter dem deine Zahlen im Ranking stehen.
            </p>
            {message && (
              <p className="form-error" role="alert" ref={alertRef} tabIndex={-1}>
                {message}
              </p>
            )}
            <ProfileSearch query={query} onQuery={setQuery} onPick={pick} notFound={missing} />
            <button type="button" className="flow-link" onClick={() => go("choice", null, null)}>
              Zurück zur Auswahl
            </button>
          </>
        )}

        {step === "contact" && mode && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {mode === "claim"
                ? "Profil übernehmen."
                : mode === "assign"
                  ? "Team um Zuordnung bitten."
                  : "Profil anlegen."}
            </h1>
            {mode === "claim" && selected && (
              <ProfileCard profile={selected} onChange={() => go("search", "claim", null)} />
            )}
            <p className="flow-lead">
              {mode === "claim"
                ? "Noch deine Kontaktdaten und ein Passwort, dann bestätigst du einmal deine E-Mail."
                : mode === "assign"
                  ? "Das Team sucht dein Profil heraus und ordnet es dir zu. Ein Hinweis hilft dabei."
                  : "Name, E-Mail, Passwort und Telefon. Danach bestätigst du einmal deine E-Mail."}
            </p>
            {isTeamProfile(selected) && mode === "claim" && (
              <div className="flow-notice">
                <strong>Das ist ein gemeinsames Teamprofil.</strong>
                <p>
                  Die Zahlen darin sind ein gemeinsames Ergebnis. Wer es übernimmt,
                  verwaltet den gemeinsamen Stand. Klärt vorher im Team, wer das tut.
                </p>
              </div>
            )}
            {message && (
              <p className="form-error" role="alert" ref={alertRef} tabIndex={-1}>
                {message}
              </p>
            )}
            <InAppHint codeEnabled={codeEnabled} />
            <form className="flow-form" onSubmit={submit} noValidate>
              <ContactFields
                afterEmail={
                  <PasswordField
                    value={password}
                    onChange={(value) => {
                      setPassword(value);
                      setPasswordError("");
                    }}
                    error={passwordError}
                    autoComplete="new-password"
                    inputRef={passwordInput}
                    note="Mindestens 8 Zeichen. Damit meldest du dich künftig an, ohne Mail."
                  />
                }
                value={contact}
                onChange={patch}
                errors={errors}
                fields={fields}
                hint={mode === "new" ? "none" : mode === "assign" ? "open" : "toggle"}
                nameSuggested={suggested && mode === "claim"}
              />
              {mode !== "new" && (
                <p className="flow-note">
                  Freigeben kann nur das Team. Es gleicht deine Angaben mit der
                  bekannten Person ab.
                </p>
              )}
              <button className="btn primary full" disabled={!ready || busy || blocked}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Mail size={18} />}
                Registrieren
                {blocked && (
                  <span className="flow-wait">
                    {" "}
                    ({Math.floor(wait / 60)}:{String(wait % 60).padStart(2, "0")})
                  </span>
                )}
              </button>
            </form>
            <PrivacyNote />
            <button
              type="button"
              className="flow-link"
              onClick={() =>
                mode === "new" ? go("choice", null, null) : go("search", "claim", null)
              }
            >
              Zurück
            </button>
          </>
        )}
      </div>
    </section>
  );
}
