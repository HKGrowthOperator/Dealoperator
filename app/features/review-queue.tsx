"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clock,
  LoaderCircle,
  MessageCircleQuestion,
  XCircle,
} from "lucide-react";
import { formatPhone } from "@/lib/phone";
import ResendConfirmation from "./resend-confirmation";

type Request = {
  id: string;
  kind: string;
  status: string;
  participant: string | null;
  full_name: string;
  email: string;
  phone: string;
  phone_input: string;
  hint: string;
  internal_note: string;
  applicant_message: string;
  applicant_answer: string | null;
  /** Letzte belegte Bestätigungsmail (Übergabe an Supabase). */
  last_mail_at: string | null;
  owner: string | null;
  created_at: string;
  decided_at: string | null;
  participant_name: string | null;
  participant_company: string | null;
  participant_role: string | null;
  participant_known_email: string | null;
  import_key: string | null;
  known_phone: string | null;
  competing: number | string;
  /** Für das Profil in Team & Rollen vorgemerkte Rolle; gilt mit der Freigabe. */
  designated_role: "admin" | "moderator" | null;
};

type Candidate = {
  id: string;
  name: string;
  company: string | null;
  kind: string;
  claimed: boolean;
  searchable: boolean;
  designated_role?: "admin" | "moderator" | null;
};

const ROLE: Record<"admin" | "moderator", string> = {
  admin: "Admin",
  moderator: "Moderator",
};

const LABEL: Record<string, string> = {
  awaiting_email: "E-Mail noch nicht bestätigt",
  pending: "Wartet auf Prüfung",
  info_needed: "Rückfrage läuft",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  superseded: "Anderes Konto freigegeben",
};

export default function ReviewQueue({
  admin,
  focus = "",
}: {
  admin: boolean;
  /** Anfrage aus dem Push-Link (?anfrage=): wird angesprungen und geöffnet. */
  focus?: string;
}) {
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string>("");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");
  // Ablehnen braucht einen zweiten, bewussten Klick.
  const [confirmReject, setConfirmReject] = useState(false);
  // Zuordnungsanfragen ohne vorgewähltes Profil: das Team wählt es hier aus.
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pick, setPick] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const freeProfiles = (list: Candidate[] | undefined) =>
    (list || []).filter((p) => !p.claimed && p.kind === "person");

  const load = useCallback(async () => {
    if (!admin) return;
    try {
      const r = await fetch("/api/operator");
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setRows(d.requests || []);
      setCandidates(freeProfiles(d.participants));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [admin]);

  // setState läuft bewusst im Callback, nicht synchron im Effektkörper.
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    fetch("/api/operator", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        setRows(data.requests || []);
        setCandidates(freeProfiles(data.participants));
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin]);

  async function decide(id: string, decision: "approve" | "reject" | "info") {
    setBusy(id + decision);
    setError("");
    try {
      const r = await fetch("/api/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decideRequest",
          value: {
            id,
            decision,
            ...(decision === "approve" && assignTo ? { participantId: assignTo } : {}),
            internalNote: note,
            applicantMessage: reply,
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setOpen("");
      setNote("");
      setReply("");
      setAssignTo("");
      setPick("");
      setConfirmReject(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // Einmal nach dem Laden: zur Anfrage aus dem Push springen und, wenn sie noch
  // offen ist, direkt die Prüfung aufklappen.
  const jumped = useRef(false);
  useEffect(() => {
    if (!focus || loading || jumped.current) return;
    const target = rows.find((r) => r.id === focus);
    if (!target) return;
    jumped.current = true;
    const timer = setTimeout(() => {
      if (["pending", "info_needed"].includes(target.status)) {
        setOpen(target.id);
        setNote(target.internal_note || "");
      }
      const el = document.getElementById(`anfrage-${target.id}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [focus, loading, rows]);

  if (!admin) return null;
  const focusMissing = !!focus && !loading && !rows.some((r) => r.id === focus);
  const waiting = rows.filter((r) =>
    ["pending", "info_needed"].includes(r.status),
  );
  const rest = rows.filter((r) => !["pending", "info_needed"].includes(r.status));

  return (
    <section className="card review-queue">
      <header>
        <div>
          <h2>Übernahmeanfragen</h2>
          <p>
            Eine bestätigte E-Mail ist noch keine Identität. Gleiche die Angaben
            mit der Person ab, die ihr bereits kennt, zum Beispiel über den
            bekannten Kontakt, und gib erst dann frei.
          </p>
        </div>
      </header>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="onboarding-hint">
          <LoaderCircle className="spin" size={16} /> Anfragen werden geladen …
        </p>
      )}
      {focusMissing && (
        <p className="onboarding-hint" role="status">
          Die Anfrage aus der Benachrichtigung ist nicht mehr in der Liste. Sie
          wurde vermutlich schon entschieden.
        </p>
      )}
      {!loading && waiting.length === 0 && (
        <p className="onboarding-hint">
          <Check size={16} /> Keine offenen Anfragen.
        </p>
      )}

      {[...waiting, ...rest].map((r) => {
        const competing = Number(r.competing) || 0;
        const decidable = ["pending", "info_needed"].includes(r.status);
        return (
          <article
            key={r.id}
            id={`anfrage-${r.id}`}
            className="review-item"
            data-focus={r.id === focus ? "" : undefined}
            tabIndex={r.id === focus ? -1 : undefined}
          >
            <div className="review-head">
              <div>
                <strong>{r.full_name}</strong>
                <small>
                  {r.participant_name ? (
                    <>
                      möchte <b>{r.participant_name}</b>
                    </>
                  ) : r.kind === "claim" ? (
                    "hat sein Profil nicht gefunden · Zuordnung durch euch"
                  ) : (
                    "möchte ein neues Profil"
                  )}
                  {r.participant_company ? ` · ${r.participant_company}` : ""}
                  {/^team\b/i.test(r.participant_role || "") && (
                    <b className="team-flag"> · Gemeinsames Teamprofil</b>
                  )}
                </small>
                {decidable && r.designated_role && (
                  <span
                    className="review-role"
                    title="In Team & Rollen für dieses Profil vorgemerkt. Mit der Freigabe bekommt das Konto die Rolle."
                  >
                    Wird nach Freigabe {ROLE[r.designated_role]}
                  </span>
                )}
              </div>
              <span className={`review-status ${r.status}`}>
                {r.status === "pending" && <Clock size={14} />}
                {r.status === "info_needed" && (
                  <MessageCircleQuestion size={14} />
                )}
                {r.status === "approved" && <Check size={14} />}
                {(r.status === "rejected" || r.status === "superseded") && (
                  <XCircle size={14} />
                )}
                {LABEL[r.status] || r.status}
              </span>
            </div>

            {competing > 0 && (
              <p className="review-warning">
                Achtung: {competing} weitere offene Anfrage
                {competing > 1 ? "n" : ""} für dieses Profil. Bitte zuerst
                klären, wer die Person wirklich ist.
              </p>
            )}

            <dl className="review-facts">
              <div>
                <dt>{r.status === "awaiting_email" ? "E-Mail (noch nicht bestätigt)" : "Bestätigte E-Mail"}</dt>
                <dd>{r.email}</dd>
              </div>
              <div>
                <dt>Telefon (angegeben, nicht geprüft)</dt>
                <dd>{formatPhone(r.phone)}</dd>
              </div>
              {r.participant_known_email && (
                <div>
                  <dt>Bekannt aus Import</dt>
                  <dd
                    className={
                      r.participant_known_email.toLowerCase() ===
                      r.email.toLowerCase()
                        ? "match"
                        : "mismatch"
                    }
                  >
                    {r.participant_known_email}
                    {r.participant_known_email.toLowerCase() ===
                    r.email.toLowerCase()
                      ? " · stimmt überein"
                      : " · weicht ab"}
                  </dd>
                </div>
              )}
              {r.known_phone && (
                <div>
                  <dt>Bereits hinterlegte Nummer</dt>
                  <dd>{formatPhone(r.known_phone)}</dd>
                </div>
              )}
              {r.import_key && (
                <div>
                  <dt>Teilnehmer-ID</dt>
                  <dd>{r.import_key}</dd>
                </div>
              )}
              {r.hint && (
                <div>
                  <dt>Zuordnungshilfe</dt>
                  <dd>{r.hint}</dd>
                </div>
              )}
              <div>
                <dt>Eingegangen</dt>
                <dd>
                  {new Date(r.created_at).toLocaleString("de-DE", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
            </dl>

            {r.applicant_answer && (
              <p className="review-note">
                <strong>Antwort auf eure Rückfrage:</strong> {r.applicant_answer}
              </p>
            )}
            {r.internal_note && (
              <p className="review-note">
                <strong>Interne Notiz:</strong> {r.internal_note}
              </p>
            )}

            {r.status === "awaiting_email" && (
              <ResendConfirmation id={r.id} lastMailAt={r.last_mail_at} onSent={load} />
            )}

            {decidable &&
              (open === r.id ? (
                <div className="form-stack review-form">
                  <label>
                    Interne Prüfnotiz
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Womit wurde abgeglichen? Nur für das Team sichtbar."
                    />
                  </label>
                  <label>
                    Nachricht an die Person
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Wird im Prüfstatus angezeigt. Für eine Rückfrage steht hier die Frage."
                    />
                    <small>
                      Die Person sieht diese Nachricht auf ihrer Statusseite und
                      kann dort auf eine Rückfrage antworten. Eine Benachrichtigung
                      an die Person gibt es nicht.
                    </small>
                  </label>
                  {r.kind === "claim" && !r.participant && (
                    <div className="review-picker">
                      <label>
                        Profil zuordnen
                        <input
                          value={pick}
                          onChange={(e) => setPick(e.target.value)}
                          placeholder="Name oder Unternehmen suchen"
                        />
                      </label>
                      <ul>
                        {candidates
                          .filter((p) =>
                            `${p.name} ${p.company || ""}`
                              .toLowerCase()
                              .includes(pick.trim().toLowerCase()),
                          )
                          .slice(0, 8)
                          .map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                className={`btn secondary${assignTo === p.id ? " chosen" : ""}`}
                                aria-pressed={assignTo === p.id}
                                onClick={() => setAssignTo(p.id)}
                              >
                                {p.name}
                                {p.company ? ` · ${p.company}` : ""}
                                {p.searchable ? "" : " · nur per Einladung"}
                                {p.designated_role
                                  ? ` · wird nach Freigabe ${ROLE[p.designated_role]}`
                                  : ""}
                              </button>
                            </li>
                          ))}
                      </ul>
                      <small>
                        Nur freie, persönliche Profile. Freigeben ordnet das gewählte
                        Profil diesem Konto zu.
                      </small>
                    </div>
                  )}
                  {confirmReject ? (
                    <div
                      className="review-confirm"
                      role="group"
                      aria-labelledby={`reject-${r.id}`}
                    >
                      <p id={`reject-${r.id}`}>
                        <strong>Anfrage wirklich ablehnen?</strong> Das lässt
                        sich nicht zurücknehmen. Die Person sieht deine
                        Nachricht auf ihrer Statusseite.
                      </p>
                      <div className="review-actions">
                        <button
                          className="btn adm-danger"
                          disabled={!!busy}
                          onClick={() => decide(r.id, "reject")}
                        >
                          {busy === r.id + "reject" && (
                            <LoaderCircle className="spin" size={16} />
                          )}
                          Ja, ablehnen
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={!!busy}
                          onClick={() => setConfirmReject(false)}
                        >
                          Zurück
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="review-actions">
                      <button
                        className="btn primary"
                        disabled={
                          !!busy ||
                          (r.kind === "claim" && !r.participant && !assignTo)
                        }
                        onClick={() => decide(r.id, "approve")}
                      >
                        {busy === r.id + "approve" ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                        {r.kind === "claim" && !r.participant
                          ? "Zuordnen und freigeben"
                          : "Freigeben"}
                      </button>
                      <button
                        className="btn secondary"
                        disabled={!!busy || reply.trim().length < 3}
                        aria-describedby={`reply-need-${r.id}`}
                        onClick={() => decide(r.id, "info")}
                      >
                        Rückfrage nötig
                      </button>
                      <button
                        className="btn secondary"
                        disabled={!!busy || reply.trim().length < 3}
                        aria-describedby={`reply-need-${r.id}`}
                        onClick={() => setConfirmReject(true)}
                      >
                        Ablehnen
                      </button>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setOpen("")}
                      >
                        Abbrechen
                      </button>
                      <small className="review-need" id={`reply-need-${r.id}`}>
                        {reply.trim().length < 3
                          ? "Für „Rückfrage nötig“ und „Ablehnen“ zuerst die Nachricht an die Person schreiben."
                          : ""}
                      </small>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className="btn secondary"
                  onClick={() => {
                    setOpen(r.id);
                    setConfirmReject(false);
                    setNote(r.internal_note || "");
                    setReply("");
                    setAssignTo("");
                    setPick("");
                  }}
                >
                  Prüfen und entscheiden
                </button>
              ))}
          </article>
        );
      })}
    </section>
  );
}
