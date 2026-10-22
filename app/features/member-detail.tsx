import Link from "next/link";
import { Phone, Mail, Globe, MapPin, CalendarDays } from "lucide-react";
import { AVAILABILITY, type DirectoryMember } from "@/lib/members";
import { MemberPhoto } from "./member-directory";
export default function MemberDetail({
  member: m,
}: {
  member: DirectoryMember;
}) {
  return (
    <main id="inhalt" className="mn-page mn-detail">
      <Link className="mn-back" href="/mitglieder">
        Alle Mitglieder
      </Link>
      <section className="mn-profile-hero">
        <MemberPhoto member={m} size="large" />
        <div>
          <h1>{m.name}</h1>
          <p className="mn-headline">{m.headline}</p>
          <p>{[m.company, m.location].filter(Boolean).join(" · ")}</p>
          <div className="mn-credentials">
            {m.packageName && <span>{m.packageName}</span>}
            {m.levels.slice(0, 2).map((l) => (
              <span key={l.label}>
                {l.label} · Level {l.level}
              </span>
            ))}
          </div>
        </div>
        <div className="mn-profile-contact">
          {m.contactPhone && (
            <a className="btn primary" href={`tel:${m.contactPhone}`}>
              <Phone size={18} />
              Anrufen
            </a>
          )}
          {m.contactEmail && (
            <a className="btn secondary" href={`mailto:${m.contactEmail}`}>
              <Mail size={18} />
              E-Mail schreiben
            </a>
          )}
          {m.mine && (
            <Link href="/mitglieder/mein-profil" className="btn secondary">
              Profil bearbeiten
            </Link>
          )}
        </div>
      </section>
      <div className="mn-detail-grid">
        <div>
          <section className="mn-section">
            <h2>Das mache ich</h2>
            {m.about && <p className="mn-lines">{m.about}</p>}
            <div className="mn-tags">
              {m.services.map((v) => (
                <span key={v}>{v}</span>
              ))}
            </div>
            {m.industries.length > 0 && (
              <>
                <h3>Für diese Branchen</h3>
                <div className="mn-tags">
                  {m.industries.map((v) => (
                    <span key={v}>{v}</span>
                  ))}
                </div>
              </>
            )}
          </section>
          {m.projects && (
            <section className="mn-section">
              <p className="mn-eyebrow">In Arbeit</p>
              <h2>Aktuelle Projekte</h2>
              <p className="mn-lines">{m.projects}</p>
            </section>
          )}
          {m.lookingFor && (
            <section className="mn-section mn-section-tint">
              <p className="mn-eyebrow">Hier können wir zusammenarbeiten</p>
              <h2>Dabei suche ich Unterstützung</h2>
              <p className="mn-lines">{m.lookingFor}</p>
            </section>
          )}
          {m.references.length > 0 && (
            <section className="mn-section">
              <h2>Referenzen & Einblicke</h2>
              <div className="mn-references">
                {m.references.map((r, i) => (
                  <article key={i}>
                    <h3>{r.title}</h3>
                    {r.description && <p>{r.description}</p>}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        Referenz ansehen
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="mn-sidebar">
          <section className="mn-section">
            <h2>Kontakt</h2>
            <p className={`mn-status ${m.availability}`}>
              {AVAILABILITY[m.availability]}
            </p>
            {m.location && (
              <p className="mn-icon-line">
                <MapPin size={17} />
                {m.location}
              </p>
            )}
            {m.contactPhone && (
              <a className="mn-icon-line" href={`tel:${m.contactPhone}`}>
                <Phone size={17} />
                {m.contactPhone}
              </a>
            )}
            {m.contactEmail && (
              <a className="mn-icon-line" href={`mailto:${m.contactEmail}`}>
                <Mail size={17} />
                {m.contactEmail}
              </a>
            )}
            {m.website && (
              <a
                className="mn-icon-line"
                href={m.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Globe size={17} />
                Website öffnen
              </a>
            )}
            <Link
              className="btn secondary full"
              href={`/calls?mit=${encodeURIComponent(m.id)}`}
            >
              <CalendarDays size={18} />
              Call verabreden
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
