"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Clock,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { formatPhone } from "@/lib/phone";

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
};

const LABEL: Record<string, string> = {
  awaiting_email: "E-Mail noch nicht bestätigt",
  pending: "Wartet auf Prüfung",
  info_needed: "Rückfrage läuft",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  superseded: "Anderes Konto freigegeben",
};

export default function ReviewQueue({ admin }: { admin: boolean }) {
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string>("");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!admin) return;
    try {
      const r = await fetch("/api/operator");
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setRows(d.requests || []);
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
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!admin) return null;
  const waiting = rows.filter((r) =>
    ["pending", "info_needed"].includes(r.status),
  );
  const rest = rows.filter((r) => !["pending", "info_needed"].includes(r.status));

  return (
    <section className="card review-queue">
      <header>
        <span className="icon-tile">
          <ShieldAlert />
        </span>
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
      {!loading && waiting.length === 0 && (
        <p className="onboarding-hint">
          <Check size={16} /> Keine offenen Anfragen.
        </p>
      )}

      {[...waiting, ...rest].map((r) => {
        const competing = Number(r.competing) || 0;
        const decidable = ["pending", "info_needed"].includes(r.status);
        return (
          <article key={r.id} className="review-item">
            <div className="review-head">
              <div>
                <strong>{r.full_name}</strong>
                <small>
                  möchte{" "}
                  {r.participant_name ? (
                    <b>{r.participant_name}</b>
                  ) : (
                    "ein neues Profil"
                  )}
                  {r.participant_company ? ` · ${r.participant_company}` : ""}
                  {/^team\b/i.test(r.participant_role || "") && (
                    <b className="team-flag"> · Gemeinsames Teamprofil</b>
                  )}
                </small>
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
                <dt>Bestätigte E-Mail</dt>
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
                  <div className="review-actions">
                    <button
                      className="btn primary"
                      disabled={!!busy}
                      onClick={() => decide(r.id, "approve")}
                    >
                      {busy === r.id + "approve" ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      Freigeben
                    </button>
                    <button
                      className="btn secondary"
                      disabled={!!busy || reply.trim().length < 3}
                      title={
                        reply.trim().length < 3
                          ? "Bitte zuerst die Frage unter „Nachricht an die Person“ eintragen."
                          : undefined
                      }
                      onClick={() => decide(r.id, "info")}
                    >
                      Rückfrage nötig
                    </button>
                    <button
                      className="btn secondary"
                      disabled={!!busy}
                      onClick={() => decide(r.id, "reject")}
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
                  </div>
                </div>
              ) : (
                <button
                  className="btn secondary"
                  onClick={() => {
                    setOpen(r.id);
                    setNote(r.internal_note || "");
                    setReply("");
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
