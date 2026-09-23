"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  Clock,
  MessageCircleQuestion,
  PartyPopper,
  Search,
  UsersRound,
  XCircle,
} from "lucide-react";
import { formatPhone } from "@/lib/phone";
import ClaimAnswer from "./claim-answer";
import { call, useStepHeading } from "./flow-parts";

export type OwnRequest = {
  kind: string;
  status: string;
  fullName: string;
  email: string;
  phone: string;
  hint: string;
  message: string;
  lastAnswer: string;
  participantName: string;
  createdAt: string;
};

/** Stand der Anfrage in drei Schritten. */
function steps(status: string, assign: boolean) {
  const decided = ["approved", "rejected", "superseded"].includes(status);
  return [
    { label: "E-Mail bestätigt", state: "done" },
    {
      label: status === "info_needed" ? "Rückfrage an dich" : "Prüfung durch das Team",
      state: decided ? "done" : "current",
    },
    {
      label:
        status === "rejected"
          ? "Nicht freigegeben"
          : status === "superseded"
            ? "Anderweitig zugeordnet"
            : assign
              ? "Zuordnung und Freigabe"
              : "Freigabe",
      state: decided ? "done" : "open",
    },
  ] as const;
}

/**
 * Prüfstatus der eigenen Anfrage. Die Seite fragt selbst nach, solange sie
 * offen ist: Eine Freigabe, Rückfrage oder Ablehnung erscheint ohne
 * Neuladen. Keine Versprechen zu Bearbeitungszeiten.
 */
export default function RequestStatus({ request }: { request: OwnRequest }) {
  const router = useRouter();
  const [status, setStatus] = useState(request.status);
  const heading = useStepHeading(status);
  const known = useRef(request.status);
  const assign = request.kind === "claim" && !request.participantName;

  useEffect(() => {
    if (!["pending", "info_needed"].includes(request.status)) return;
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const data = await call<{ request: { status: string } | null }>(
          "/api/onboarding?status=eigen",
        );
        const next = data.request?.status;
        if (!next || next === known.current) return;
        known.current = next;
        if (next === "approved") setStatus("approved");
        // Rückfrage, Ablehnung oder neue Nachricht: frische Angaben vom Server.
        else router.refresh();
      } catch {
        /* nächster Versuch beim nächsten Takt */
      }
    }
    const timer = setInterval(check, 20000);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [request.status, router]);

  // Neue Serverdaten (router.refresh) übernehmen.
  useEffect(() => {
    known.current = request.status;
    const timer = setTimeout(() => setStatus(request.status), 0);
    return () => clearTimeout(timer);
  }, [request.status]);

  if (status === "approved")
    return (
      <section className="auth-card card flow" aria-live="polite">
        <div className="flow-step">
          <span className="icon-tile lime">
            <PartyPopper />
          </span>
          <h1 ref={heading} tabIndex={-1}>
            Dein Profil ist freigegeben.
          </h1>
          <p className="flow-lead">
            {request.participantName
              ? `„${request.participantName}“ gehört jetzt zu deinem Konto. Deine bisherigen Zahlen sind da.`
              : "Das Team hat dir dein Profil zugeordnet. Deine bisherigen Zahlen sind da."}
          </p>
          <div className="flow-actions">
            <Link className="btn primary full" href="/tagesabschluss">
              Tagesabschluss eintragen
            </Link>
            <Link className="flow-link" href="/heute?modus=eigen">
              Zu meinen Zahlen
            </Link>
          </div>
        </div>
      </section>
    );

  const closed = status === "rejected" || status === "superseded";
  const submitted = new Date(request.createdAt).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <section className="auth-card card flow">
      <div className="flow-step" key={status}>
        <span className="icon-tile lime">
          {status === "info_needed" ? (
            <MessageCircleQuestion />
          ) : closed ? (
            <XCircle />
          ) : (
            <Clock />
          )}
        </span>
        <h1 ref={heading} tabIndex={-1}>
          {status === "info_needed"
            ? "Rückfrage vom Team."
            : status === "rejected"
              ? "Diese Übernahme wurde nicht freigegeben."
              : status === "superseded"
                ? "Dieses Profil ist bereits zugeordnet."
                : assign
                  ? "E-Mail bestätigt. Das Team sucht dein Profil heraus."
                  : "E-Mail bestätigt. Deine Profilübernahme wird geprüft."}
        </h1>
        <p className="flow-lead">
          {status === "info_needed"
            ? "Beantworte sie hier. Danach geht deine Anfrage zurück in die Prüfung."
            : status === "rejected"
              ? "Das Team konnte die Übernahme nicht bestätigen. Hier sind deine Möglichkeiten."
              : status === "superseded"
                ? "Ein anderes Konto wurde dafür freigegeben. Hier sind deine Möglichkeiten."
                : "Freigeben kann nur das Team. Diese Seite zeigt die Entscheidung, sobald sie da ist."}
        </p>

        <ol className="flow-steps" aria-label="Stand deiner Anfrage">
          {steps(status, assign).map((s) => (
            <li
              key={s.label}
              data-state={s.state}
              aria-current={s.state === "current" ? "step" : undefined}
            >
              <span aria-hidden="true">{s.state === "done" ? <Check size={14} /> : null}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {request.participantName && (
          <div className="flow-profile">
            <div>
              <span>Angefragtes Profil</span>
              <strong>{request.participantName}</strong>
            </div>
          </div>
        )}

        {request.message && (
          <div className="flow-notice">
            <strong>Nachricht vom Team</strong>
            <p>{request.message}</p>
          </div>
        )}

        {status === "info_needed" && <ClaimAnswer />}

        {status === "pending" && request.lastAnswer && (
          <div className="flow-notice">
            <strong>Deine Antwort liegt beim Team.</strong>
            <p>{request.lastAnswer}</p>
          </div>
        )}

        {status === "pending" && (
          <p className="flow-body">
            Bis dahin kannst du das öffentliche Ranking ansehen. Nach der Freigabe
            trägst du neue Tage selbst ein.
          </p>
        )}

        {closed && (
          <div className="flow-choices">
            <Link className="flow-option" href="/profil-uebernehmen">
              <Search aria-hidden="true" />
              <span>
                <strong>Anderes Profil suchen</strong>
                <small>Vielleicht stehen deine Zahlen unter einem anderen Namen.</small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
            <Link className="flow-option" href="/profil-uebernehmen?weg=team">
              <UsersRound aria-hidden="true" />
              <span>
                <strong>Team um Zuordnung bitten</strong>
                <small>Mit einem Hinweis, woran das Team dich erkennt.</small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </div>
        )}
        {closed && (
          <p className="flow-small">
            Du hast noch keine Zahlen hier?{" "}
            <Link href="/start?weiter=eigen">Neues Profil anlegen</Link>
          </p>
        )}

        <dl className="flow-summary">
          <div>
            <dt>Angefragt am</dt>
            <dd>{submitted}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{request.fullName}</dd>
          </div>
          <div>
            <dt>Bestätigte E-Mail</dt>
            <dd>{request.email}</dd>
          </div>
          <div>
            <dt>Telefon (nicht geprüft)</dt>
            <dd>{formatPhone(request.phone)}</dd>
          </div>
          {request.hint && (
            <div>
              <dt>Hinweis für das Team</dt>
              <dd>{request.hint}</dd>
            </div>
          )}
        </dl>

        {!closed && (
          <div className="flow-actions">
            <Link className="flow-link" href="/ranking">
              Zum öffentlichen Ranking
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
