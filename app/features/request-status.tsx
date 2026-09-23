import Link from "next/link";
import { Check, Clock, MessageCircleQuestion, ShieldCheck, XCircle } from "lucide-react";
import ClaimAnswer from "./claim-answer";

const VIEW: Record<
  string,
  { icon: React.ReactNode; title: string; lead: string; tone: string }
> = {
  pending: {
    icon: <Clock />,
    tone: "",
    title: "Deine Anfrage ist in Prüfung.",
    lead: "Das Deal-Operator-Team gleicht deine Angaben ab und gibt das Profil frei, sobald die Zuordnung eindeutig ist.",
  },
  info_needed: {
    icon: <MessageCircleQuestion />,
    tone: "",
    title: "Rückfrage vom Team.",
    lead: "Damit das Team das Profil sicher zuordnen kann, braucht es noch eine Angabe von dir. Antworte einfach hier.",
  },
  rejected: {
    icon: <XCircle />,
    tone: "",
    title: "Diese Übernahme wurde nicht freigegeben.",
    lead: "Du kannst ein eigenes Profil anlegen oder ein anderes Profil anfragen.",
  },
  superseded: {
    icon: <XCircle />,
    tone: "",
    title: "Dieses Profil ist bereits zugeordnet.",
    lead: "Ein anderes Konto wurde dafür freigegeben. Du kannst ein eigenes Profil anlegen oder ein anderes Profil anfragen.",
  },
  approved: {
    icon: <Check />,
    tone: "lime",
    title: "Dein Profil ist freigegeben.",
    lead: "Deine bisherigen Zahlen stehen dir jetzt zur Verfügung.",
  },
};

/** Schritte der Anfrage, damit der Stand auf einen Blick lesbar ist. */
function steps(status: string) {
  const reviewLabel = status === "info_needed" ? "Rückfrage nötig" : "In Prüfung";
  const done = (s: string[]) => s.includes(status);
  return [
    { label: "Anfrage eingegangen", state: "done" },
    {
      label: reviewLabel,
      state: done(["approved", "rejected", "superseded"]) ? "done" : "current",
    },
    {
      label:
        status === "rejected"
          ? "Nicht freigegeben"
          : status === "superseded"
            ? "Anderweitig zugeordnet"
            : "Freigegeben",
      state: done(["approved", "rejected", "superseded"]) ? "done" : "open",
    },
  ] as const;
}

export default function RequestStatus({
  request,
}: {
  request: {
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
}) {
  const view = VIEW[request.status] ?? VIEW.pending;
  const submitted = new Date(request.createdAt).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const closed = ["rejected", "superseded"].includes(request.status);
  return (
    <section className="auth-card card">
      <span className={`icon-tile ${view.tone}`}>{view.icon}</span>
      <h1>{view.title}</h1>
      <p>{view.lead}</p>

      <ol className="request-steps" aria-label="Stand deiner Anfrage">
        {steps(request.status).map((s) => (
          <li key={s.label} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span aria-hidden="true">{s.state === "done" ? <Check size={14} /> : null}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {request.participantName && (
        <div className="onboarding-selected compact">
          <span>Angefragtes Profil</span>
          <strong>{request.participantName}</strong>
        </div>
      )}

      {request.message && (
        <div className="notice">
          <strong>Nachricht vom Team</strong>
          <p>{request.message}</p>
        </div>
      )}

      {request.status === "info_needed" && <ClaimAnswer />}

      {request.status === "pending" && request.lastAnswer && (
        <div className="notice">
          <strong>Deine Antwort ist beim Team.</strong>
          <p>{request.lastAnswer}</p>
        </div>
      )}

      {request.status === "pending" && (
        <div className="notice">
          <strong>Was jetzt passiert.</strong>
          <p>
            Das Team gleicht deine Angaben mit der Person ab, die es bereits
            kennt. Nach der Freigabe trägst du neue Tage selbst ein; Korrekturen
            an übernommenen Tagen laufen über das Team. Das öffentliche Ranking
            kannst du schon jetzt ansehen.
          </p>
        </div>
      )}

      {closed && (
        <div className="request-actions">
          <Link className="btn primary full" href="/start?weiter=eigen">
            Eigenes Profil anlegen
          </Link>
          <Link className="btn secondary full" href="/profil-uebernehmen">
            Anderes Profil anfragen
          </Link>
        </div>
      )}

      <dl className="request-summary">
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
          <dt>Telefon</dt>
          <dd>{request.phone}</dd>
        </div>
        {request.hint && (
          <div>
            <dt>Zuordnungshilfe</dt>
            <dd>{request.hint}</dd>
          </div>
        )}
      </dl>

      {!closed && (
        <Link className="btn secondary full" href="/ranking">
          Zum öffentlichen Ranking
        </Link>
      )}

      <div className="auth-note">
        <ShieldCheck size={20} />
        <span>
          Eine bestätigte E-Mail allein gibt kein Profil frei. Das schützt die
          Zahlen der Person, die bereits dahintersteht.
        </span>
      </div>
    </section>
  );
}
