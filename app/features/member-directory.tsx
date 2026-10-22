"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Phone,
  Mail,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import {
  AVAILABILITY,
  matchesMember,
  type DirectoryMember,
} from "@/lib/members";

export function MemberPhoto({
  member,
  size = "normal",
}: {
  member: Pick<DirectoryMember, "name" | "avatarUrl">;
  size?: "normal" | "large";
}) {
  return member.avatarUrl ? (
    // Private endpoint: no Next image optimizer or publicly cached avatar URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`mn-avatar ${size}`}
      src={member.avatarUrl}
      alt={`Profilbild von ${member.name}`}
      width={size === "large" ? 112 : 64}
      height={size === "large" ? 112 : 64}
      loading={size === "large" ? "eager" : "lazy"}
    />
  ) : (
    <span className={`mn-avatar mn-initials ${size}`} aria-hidden="true">
      {member.name
        .split(/\s+/)
        .map((v) => v[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
export function NetworkTabs({
  active = "members",
}: {
  active?: "members" | "offers";
}) {
  return (
    <nav className="nw-tabs" aria-label="Mitgliederbereich">
      <Link
        href="/mitglieder"
        aria-current={active === "members" ? "page" : undefined}
      >
        Mitglieder
      </Link>
      <Link
        href="/mitglieder/angebote"
        aria-current={active === "offers" ? "page" : undefined}
      >
        Angebote
      </Link>
    </nav>
  );
}
export default function MemberDirectory({
  members,
}: {
  members: DirectoryMember[];
}) {
  const [query, setQuery] = useState("");
  const [available, setAvailable] = useState(false),
    [limit, setLimit] = useState(24);
  const shown = useMemo(
    () =>
      members.filter(
        (m) =>
          m.listed &&
          (!available || m.availability === "offen") &&
          matchesMember(m, query),
      ),
    [members, query, available],
  );
  return (
    <main id="inhalt" className="mn-page nw-directory nw-members">
      <NetworkTabs />
      <header className="mn-heading">
        <div>
          <p className="mn-eyebrow">Know-how & Kontakte</p>
          <h1>
            Mitglieder<span>.</span>
          </h1>
        </div>
        <Link className="btn secondary" href="/mitglieder/mein-profil">
          Mein Profil
        </Link>
      </header>
      <div className="nw-searchbar">
        <label className="mn-search">
          <Search size={21} aria-hidden="true" />
          <span className="sr-only">Mitglieder suchen</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(24);
            }}
            placeholder="Name, Tätigkeit oder Branche"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Suche leeren"
            >
              ×
            </button>
          )}
        </label>
        <button
          className={`mn-filter ${available ? "active" : ""}`}
          aria-pressed={available}
          onClick={() => setAvailable(!available)}
        >
          <SlidersHorizontal size={16} />
          Offen für Zusammenarbeit
        </button>
      </div>
      <p className="mn-results" role="status">
        {shown.length} {shown.length === 1 ? "Mitglied" : "Mitglieder"}
        {query && <> für „{query}“</>}
      </p>
      <div className="nw-people">
        {shown.slice(0, limit).map((m) => (
          <article className="nw-person" key={m.id}>
            <Link
              className="nw-person-identity"
              href={`/mitglieder/${encodeURIComponent(m.id)}`}
            >
              <MemberPhoto member={m} />
              <div>
                <h2>{m.name}</h2>
                <p>{m.headline}</p>
                {(m.company || m.location) && (
                  <small>
                    {[m.company, m.location].filter(Boolean).join(" · ")}
                  </small>
                )}
              </div>
            </Link>
            <div className="nw-expertise">
              <p>{m.services.slice(0, 3).join(" · ")}</p>
              <span>{m.industries.slice(0, 3).join(" · ")}</span>
              {m.references.length > 0 && (
                <small>
                  {m.references.length}{" "}
                  {m.references.length === 1
                    ? "Projekteinblick"
                    : "Projekteinblicke"}
                </small>
              )}
            </div>
            <div className="nw-person-contact">
              <span className={`mn-status ${m.availability}`}>
                {AVAILABILITY[m.availability]}
              </span>
              <div>
                <Link
                  className="btn secondary"
                  href={`/mitglieder/${encodeURIComponent(m.id)}`}
                >
                  Profil ansehen
                </Link>
                {m.contactPhone ? (
                  <a
                    className="mn-contact"
                    href={`tel:${m.contactPhone}`}
                    aria-label={`${m.name} anrufen`}
                  >
                    <Phone size={19} />
                  </a>
                ) : m.contactEmail ? (
                  <a
                    className="mn-contact"
                    href={`mailto:${m.contactEmail}`}
                    aria-label={`${m.name} eine E-Mail schreiben`}
                  >
                    <Mail size={19} />
                  </a>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!shown.length && (
        <div className="mn-empty">
          <UsersRound size={28} />
          <h2>
            {query
              ? "Noch kein passender Treffer."
              : "Hier entsteht das Verzeichnis."}
          </h2>
          <p>
            {query
              ? "Versuche eine andere Tätigkeit oder Branche. Unter Angebote kannst du einen Auftrag zur Weitergabe einstellen."
              : "Mitglieder ergänzen ihre Tätigkeit, Erfahrungen und Kontaktmöglichkeiten im Profil."}
          </p>
          <Link
            className="btn secondary"
            href={query ? "/mitglieder/angebote" : "/mitglieder/mein-profil"}
          >
            {query ? "Zu den Angeboten" : "Mein Profil ergänzen"}
          </Link>
        </div>
      )}
      {shown.length > limit && (
        <button
          className="btn secondary mn-more"
          onClick={() => setLimit(limit + 24)}
        >
          Weitere Mitglieder
        </button>
      )}
    </main>
  );
}
