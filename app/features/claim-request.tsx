"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LoaderCircle, Send, UserPlus, UsersRound } from "lucide-react";
import { splitPhone } from "@/lib/phone";
import {
  call,
  checkContact,
  ContactFields,
  EMPTY_CONTACT,
  FlowProgress,
  focusFirstError,
  isTeamProfile,
  PrivacyNote,
  ProfileCard,
  ProfileSearch,
  RequestError,
  useStepHeading,
  type Contact,
  type ContactField,
  type FieldErrors,
  type Profile,
} from "./flow-parts";

type Mode = "claim" | "assign";
type Step = "search" | "contact";
const STEPS: Record<Mode, string[]> = {
  claim: ["Profil finden", "Deine Angaben", "Prüfung durch das Team"],
  assign: ["Profil suchen", "Deine Angaben", "Zuordnung durch das Team"],
};
const FIELDS: ContactField[] = ["fullName", "phone", "hint"];

/**
 * Übernahme mit einem angemeldeten Konto: Profil suchen (oder aus Link bzw.
 * Einladung übernehmen), Angaben ergänzen, Anfrage senden. Die E-Mail ist
 * bereits bestätigt, deshalb gibt es keine zweite Mail. Freigeben kann nur
 * das Team.
 */
export default function ClaimRequest({
  email,
  phone,
  preselected,
  invite,
  problem,
  needsInvite = "",
  assign = false,
  taken = "",
}: {
  email: string;
  phone: string;
  preselected: Profile | null;
  invite: string;
  problem: string;
  needsInvite?: string;
  /** Direkt „Team um Zuordnung bitten“ (z. B. nach einer Ablehnung). */
  assign?: boolean;
  /** Name eines per Link gewählten, aber schon vergebenen Profils. */
  taken?: string;
}) {
  const router = useRouter();
  const known = splitPhone(phone);
  const [mode, setMode] = useState<Mode>(assign && !preselected ? "assign" : "claim");
  const [step, setStep] = useState<Step>(preselected || assign ? "contact" : "search");
  const [selected, setSelected] = useState<Profile | null>(preselected);
  const [query, setQuery] = useState("");
  const [contact, setContact] = useState<Contact>({
    ...EMPTY_CONTACT,
    email,
    fullName: preselected && !isTeamProfile(preselected) ? preselected.name : "",
    phone: phone ? known.national : "",
    phoneCountry: phone ? known.country : EMPTY_CONTACT.phoneCountry,
  });
  const [suggested, setSuggested] = useState(Boolean(preselected));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState(problem);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const fields = useRef<Partial<Record<ContactField, HTMLElement | null>>>({});
  const profiles = useRef<Record<string, Profile>>(preselected ? { [preselected.id]: preselected } : {});
  const heading = useStepHeading(`${step}:${mode}`);

  useEffect(() => {
    function onPop() {
      const params = new URLSearchParams(window.location.search);
      const profile = profiles.current[params.get("profil") || ""] ?? null;
      const team = params.get("weg") === "team";
      setMode(team ? "assign" : "claim");
      setSelected(team ? null : profile);
      setStep(team || profile ? "contact" : "search");
      setErrors({});
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(nextStep: Step, nextMode: Mode, profile: Profile | null) {
    if (profile) profiles.current[profile.id] = profile;
    setStep(nextStep);
    setMode(nextMode);
    setSelected(profile);
    setErrors({});
    const params = new URLSearchParams();
    if (nextMode === "assign") params.set("weg", "team");
    else if (profile && nextStep === "contact") {
      params.set("profil", profile.id);
      if (invite && profile.id === preselected?.id) params.set("einladung", invite);
    }
    const q = params.toString();
    window.history.pushState(null, "", `/profil-uebernehmen${q ? `?${q}` : ""}`);
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

  function toAssign(searched: string, hint = "") {
    setMessage("");
    setContact((c) => ({
      ...c,
      fullName: suggested ? "" : c.fullName,
      hint: c.hint || hint || (searched ? `Gesucht nach „${searched}“` : ""),
    }));
    setSuggested(false);
    go("contact", "assign", null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const found = checkContact(contact, false);
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, fields);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await call("/api/onboarding", {
        action: "claim",
        value: {
          ...(mode === "claim" && selected ? { participantId: selected.id } : {}),
          ...(mode === "claim" && invite && selected?.id === preselected?.id ? { invite } : {}),
          fullName: contact.fullName.trim(),
          phone: contact.phone.trim(),
          phoneCountry: contact.phoneCountry,
          hint: contact.hint.trim(),
        },
      });
      router.replace("/status");
      router.refresh();
    } catch (err) {
      const e = err as RequestError;
      if (e.field && FIELDS.includes(e.field as ContactField)) {
        const next = { [e.field]: e.message } as FieldErrors;
        setErrors(next);
        focusFirstError(next, fields);
      } else setMessage(e.message);
      inFlight.current = false;
      setBusy(false);
    }
  }

  const missing = (searched: string, hadResults: boolean) => (
    <div className="flow-missing">
      <strong>
        {hadResults ? "Dein Profil ist nicht dabei?" : `Kein freies Profil zu „${searched}“ gefunden.`}
      </strong>
      <p>Versuch eine andere Schreibweise oder nur deinen Vornamen. Sonst:</p>
      <button type="button" className="flow-option" onClick={() => toAssign(searched)}>
        <UsersRound aria-hidden="true" />
        <span>
          <strong>Meine Zahlen müssten schon hier sein</strong>
          <small>Das Team sucht dein Profil heraus und ordnet es dir zu.</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <Link className="flow-option" href="/start?weiter=eigen">
        <UserPlus aria-hidden="true" />
        <span>
          <strong>Ich habe noch keine Zahlen</strong>
          <small>Leg ein neues Profil an und trag deinen ersten Tag ein.</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </div>
  );

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={`${step}:${mode}`}>
        <FlowProgress steps={STEPS[mode]} current={step === "search" ? 0 : 1} />
        {step === "search" ? (
          <>
            <h1 ref={heading} tabIndex={-1}>
              Finde dein Profil.
            </h1>
            <p className="flow-lead">
              Such nach dem Namen, unter dem deine Zahlen im Ranking stehen.
            </p>
            {message && (
              <p role="alert" className="form-error">
                {message}
              </p>
            )}
            {taken && (
              <div className="flow-alert">
                <p>
                  „{taken}“ ist bereits einem anderen Konto zugeordnet. Wenn das
                  dein Profil ist, klärt das Team die Zuordnung. Es entsteht kein
                  zweites Profil.
                </p>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => toAssign("", `Betrifft das bereits vergebene Profil „${taken}“.`)}
                >
                  Team um Zuordnung bitten
                </button>
              </div>
            )}
            {needsInvite && (
              <form className="flow-form" action="/profil-uebernehmen" method="get">
                <input type="hidden" name="profil" value={needsInvite} />
                <div className="flow-field">
                  <label htmlFor="flow-invite">Code aus deiner Einladung</label>
                  <input id="flow-invite" name="einladung" required maxLength={200} autoComplete="off" />
                </div>
                <button className="btn primary full">Profil mit Einladung öffnen</button>
              </form>
            )}
            <ProfileSearch query={query} onQuery={setQuery} onPick={pick} notFound={missing} />
          </>
        ) : (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {mode === "assign" ? "Team um Zuordnung bitten." : "Profil übernehmen."}
            </h1>
            {mode === "claim" && selected && (
              <ProfileCard profile={selected} onChange={() => go("search", "claim", null)} />
            )}
            <p className="flow-lead">
              {mode === "assign"
                ? "Das Team sucht dein Profil heraus und ordnet es dir zu. Ein Hinweis hilft dabei."
                : "Noch zwei Angaben, dann geht die Anfrage an das Team."}
            </p>
            {isTeamProfile(selected) && (
              <div className="flow-notice">
                <strong>Das ist ein gemeinsames Teamprofil.</strong>
                <p>
                  Die Zahlen darin sind ein gemeinsames Ergebnis. Wer es übernimmt,
                  verwaltet den gemeinsamen Stand. Klärt vorher im Team, wer das tut.
                </p>
              </div>
            )}
            {message && (
              <p role="alert" className="form-error">
                {message}
              </p>
            )}
            <form className="flow-form" onSubmit={submit} noValidate>
              <p className="flow-note">
                Angemeldet als <strong>{email}</strong>
              </p>
              <ContactFields
                value={contact}
                onChange={patch}
                errors={errors}
                fields={fields}
                email="hidden"
                hint={mode === "assign" ? "open" : "toggle"}
                nameSuggested={suggested && mode === "claim"}
              />
              <p className="flow-note">
                Freigeben kann nur das Team. Es gleicht deine Angaben mit der
                bekannten Person ab.
              </p>
              <button className="btn primary full" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
                {mode === "assign" ? "Anfrage an das Team senden" : "Übernahme anfragen"}
              </button>
            </form>
            <PrivacyNote />
            <button type="button" className="flow-link" onClick={() => go("search", "claim", null)}>
              {mode === "assign" ? "Doch selbst suchen" : "Zurück zur Suche"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
