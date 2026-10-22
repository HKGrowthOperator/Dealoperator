"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Phone,
  Mail,
  MapPin,
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
export default function MemberDirectory({
  members,
}: {
  members: DirectoryMember[];
}) {
  const [query, setQuery] = useState(""),
    [available, setAvailable] = useState(false);
  const [scope, setScope] = useState<"angebote" | "gesuche" | "projekte">(
    "angebote",
  );
  const [limit, setLimit] = useState(24);
  const shown = useMemo(
    () =>
      members.filter(
        (v) =>
          v.listed &&
          (scope !== "gesuche" || !!v.lookingFor) &&
          (scope !== "projekte" || !!v.projects) &&
          (!available || v.availability === "offen") &&
          matchesMember(v, query, scope),
      ),
    [members, query, available, scope],
  );
  const tags = [
    ...new Set(members.filter((m) => m.listed).flatMap((m) => m.services)),
  ]
    .sort((a, b) => a.localeCompare(b, "de"))
    .slice(0, 7);
  return (
    <main id="inhalt" className="mn-page">
      <header className="mn-heading">
        <div>
          <p className="mn-eyebrow">Zusammenarbeit</p>
          <h1>
            Finde das passende
            <br />
            <span>Know-how.</span>
          </h1>
          <p>Angebote, Gesuche und Projekte an einem Ort.</p>
        </div>
        <Link className="btn secondary" href="/mitglieder/mein-profil">
          Mein Profil bearbeiten
        </Link>
      </header>
      <section className="mn-search-panel" aria-label="Mitglieder suchen">
        <nav className="mn-search-scopes" aria-label="Was suchst du?">
          {(["angebote", "gesuche", "projekte"] as const).map((value) => (
            <button
              type="button"
              className={scope === value ? "active" : ""}
              key={value}
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
                setLimit(24);
              }}
            >
              {value === "angebote"
                ? "Angebote"
                : value === "gesuche"
                  ? "Gesuche"
                  : "Projekte"}
            </button>
          ))}
        </nav>
        <label className="mn-search">
          <Search size={22} aria-hidden="true" />
          <span className="sr-only">Name, Angebot oder Branche suchen</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(24);
            }}
            placeholder="Zum Beispiel Recruiting Handwerk"
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
        <div className="mn-filters">
          {!query && (
            <div className="mn-tags">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className={query === tag ? "active" : ""}
                  onClick={() => setQuery(query === tag ? "" : tag)}
                  aria-pressed={query === tag}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <button
            className={`mn-filter ${available ? "active" : ""}`}
            onClick={() => setAvailable(!available)}
            aria-pressed={available}
          >
            <SlidersHorizontal size={16} />
            Offen für Zusammenarbeit
          </button>
        </div>
      </section>
      <p className="mn-results" role="status">
        {shown.length}{" "}
        {shown.length === 1 ? "passendes Profil" : "passende Profile"}
      </p>
      <div className="mn-grid">
        {shown.slice(0, limit).map((m) => (
          <article className="mn-card" key={m.id}>
            <div className="mn-person">
              <MemberPhoto member={m} />
              <div>
                <h2>
                  <Link href={`/mitglieder/${encodeURIComponent(m.id)}`}>
                    {m.name}
                  </Link>
                </h2>
                {m.company && <p>{m.company}</p>}
                {m.location && (
                  <p className="mn-location">
                    <MapPin size={13} />
                    {m.location}
                  </p>
                )}
              </div>
            </div>
            <p className="mn-headline">{m.headline}</p>
            <div className="mn-tags">
              {[...m.services, ...m.industries].slice(0, 5).map((v, i) => (
                <span key={`${v}-${i}`}>{v}</span>
              ))}
            </div>
            {m.lookingFor && (
              <div className="mn-seeking">
                <span>Ich suche gerade</span>
                <p>{m.lookingFor}</p>
              </div>
            )}
            <div className="mn-card-foot">
              <span className={`mn-status ${m.availability}`}>
                {AVAILABILITY[m.availability]}
              </span>
              <div className="mn-actions">
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
      {shown.length > limit && (
        <button
          type="button"
          className="btn secondary mn-more"
          onClick={() => setLimit(limit + 24)}
        >
          Weitere Profile anzeigen
        </button>
      )}
      {!shown.length && (
        <section className="mn-empty">
          <UsersRound size={32} />
          <h2>
            {members.some((m) => m.listed)
              ? "Noch kein passender Treffer."
              : "Hier beginnt die Zusammenarbeit."}
          </h2>
          <p>
            {members.some((m) => m.listed)
              ? "Probiere ein Angebot, eine Branche oder einen Namen."
              : "Zeig, was du machst und wobei du Unterstützung suchst."}
          </p>
          <Link className="btn primary" href="/mitglieder/mein-profil">
            Eigenes Profil ergänzen
          </Link>
        </section>
      )}
    </main>
  );
}
