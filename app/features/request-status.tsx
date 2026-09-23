import Link from "next/link";
import { Check, Clock, MessageCircleQuestion, ShieldCheck, XCircle } from "lucide-react";

const VIEW: Record<
  string,
  { icon: React.ReactNode; title: string; lead: string; tone: string }
> = {
  pending: {
    icon: <Clock />,
    tone: "",
    title: "Deine E-Mail ist bestätigt.",
    lead: "Das Deal-Operator-Team prüft jetzt deine Profilübernahme.",
  },
  info_needed: {
    icon: <MessageCircleQuestion />,
    tone: "",
    title: "Das Team hat eine Rückfrage.",
    lead: "Damit wir dein Profil sicher zuordnen können, fehlt uns noch eine Information.",
  },
  rejected: {
    icon: <XCircle />,
    tone: "",
    title: "Diese Übernahme wurde nicht freigegeben.",
    lead: "Melde dich kurz beim Team, dann richten wir dir ein eigenes Profil ein.",
  },
  superseded: {
    icon: <XCircle />,
    tone: "",
    title: "Dieses Profil wurde bereits zugeordnet.",
    lead: "Ein anderes Konto wurde für dieses Profil freigegeben. Melde dich kurz beim Team, dann richten wir dir ein eigenes Profil ein.",
  },
  approved: {
    icon: <Check />,
    tone: "lime",
    title: "Dein Profil ist freigegeben.",
    lead: "Deine bisherigen Zahlen stehen dir jetzt zur Verfügung.",
  },
};

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
  return (
    <section className="auth-card card">
      <span className={`icon-tile ${view.tone}`}>{view.icon}</span>
      <h1>{view.title}</h1>
      <p>{view.lead}</p>

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

      {request.status === "pending" && (
        <div className="notice">
          <strong>Was jetzt passiert.</strong>
          <p>
            Wir gleichen deine Angaben mit der Person ab, die wir bereits
            kennen — zum Beispiel über den bestehenden Kontakt. Nach der
            Freigabe trägst du neue Tage selbst ein; Korrekturen an übernommenen
            Tagen laufen über das Team. Das öffentliche Ranking kannst du schon
            jetzt ansehen.
          </p>
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

      <Link className="btn secondary full" href="/ranking">
        Zum öffentlichen Ranking
      </Link>
      <a
        className="text-link"
        href="https://discord.gg/NjkFJtBkZm"
        target="_blank"
        rel="noreferrer"
      >
        Austausch auf Discord
      </a>

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
