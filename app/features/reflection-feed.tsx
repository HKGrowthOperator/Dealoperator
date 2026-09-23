"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, ExternalLink, LoaderCircle, MessageCircle, RefreshCw } from "lucide-react";
import { shortMetricLabels } from "@/lib/kpis";
import {
  ApiError,
  COUNT_KEYS,
  EligibilityChecklist,
  formatFullDay,
  getJson,
  todayIn,
  type CountKey,
  type MissingReason,
} from "./closing-form";
import "../commitment.css";

/*
 * Austausch der Reflexionen. Nur echte, vollständig eingereichte
 * Tagesabschlüsse. Keine lokale Antwortbox: Antworten laufen auf Discord,
 * und solange es dort keinen passenden Beitrag gibt, sagt die Karte das.
 */

export type ReflectionCard = {
  participant: string;
  name: string;
  day: string;
  submittedAt: string;
  numbers: Partial<Record<CountKey, number | null>> | null;
  energy: number;
  win: string;
  next: string;
  help?: string;
  reply: { kind: "post" | "invite"; url: string };
};
export type ReflectionFeedData = {
  allowed: boolean;
  missing?: MissingReason[];
  cards: ReflectionCard[];
  people: { id: string; name: string }[];
  next?: string | null;
};
type Filter = { tag: string; person: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
const submittedText = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));

function query(filter: Filter, before?: string) {
  const params = new URLSearchParams();
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.person) params.set("person", filter.person);
  if (before) params.set("vor", before);
  const q = params.toString();
  return `/api/reflections${q ? `?${q}` : ""}`;
}

function Card({ card }: { card: ReflectionCard }) {
  const numbers = card.numbers
    ? COUNT_KEYS.filter((k) => typeof card.numbers?.[k] === "number")
    : [];
  return (
    <article className="cm-feed-card">
      <header>
        <span className="cm-avatar" aria-hidden="true">
          {initials(card.name)}
        </span>
        <div>
          <h3>{card.name}</h3>
          <p>
            Leistungstag <time dateTime={card.day}>{formatFullDay(card.day)}</time>
            <span className="cm-dot" aria-hidden="true">
              ·
            </span>
            <span className="cm-muted">eingereicht {submittedText(card.submittedAt)}</span>
          </p>
        </div>
      </header>

      <div className="cm-feed-meta">
        <div className="cm-energy-read" aria-label={`Energie ${card.energy} von 10`}>
          <span>Energie</span>
          <span className="cm-energy-bar" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} className={i < card.energy ? "on" : ""} />
            ))}
          </span>
          <strong>{card.energy}/10</strong>
        </div>
        {card.numbers === null ? (
          <p className="cm-muted cm-small">Zahlen nicht öffentlich freigegeben.</p>
        ) : numbers.length > 0 ? (
          <dl className="cm-feed-numbers">
            {numbers.map((k) => (
              <div key={k}>
                <dt>{shortMetricLabels[k]}</dt>
                <dd>{(card.numbers![k] as number).toLocaleString("de-DE")}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="cm-feed-text">
        <h4>Lief richtig gut</h4>
        <p>{card.win}</p>
        <h4>Nächster Calling-Tag</h4>
        <p>{card.next}</p>
        {/* Der Unterstützungswunsch geht nur an das Team, nie in den Austausch. */}
      </div>

      <footer>
        <a
          className="btn secondary"
          href={card.reply.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={16} aria-hidden="true" />
          Antworten auf Discord
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        {card.reply.kind === "invite" && (
          <small>
            Zu diesem Abschluss gibt es noch keinen Discord-Beitrag. Über den Einladungslink kommst
            du in den Austausch.
          </small>
        )}
      </footer>
    </article>
  );
}

export default function ReflectionFeed({ initial }: { initial?: ReflectionFeedData | null }) {
  const uid = useId();
  const [feed, setFeed] = useState<ReflectionFeedData | null>(initial ?? null);
  const [filter, setFilter] = useState<Filter>({ tag: "", person: "" });
  const [loading, setLoading] = useState<"list" | "more" | null>(initial ? null : "list");
  const [error, setError] = useState<{ text: string; status: number } | null>(null);
  const request = useRef(0);

  const load = useCallback(async (next: Filter, before?: string) => {
    const id = ++request.current;
    setLoading(before ? "more" : "list");
    setError(null);
    try {
      const data = await getJson<ReflectionFeedData>(query(next, before));
      if (id !== request.current) return;
      setFeed((current) =>
        before && current
          ? { ...data, cards: [...current.cards, ...data.cards] }
          : data,
      );
    } catch (e) {
      if (id !== request.current) return;
      const err = e as ApiError;
      const data = err.data as Partial<ReflectionFeedData>;
      if (err.status === 401 || data?.allowed === false)
        setFeed({ allowed: false, missing: data.missing ?? ["login"], cards: [], people: [] });
      else setError({ text: err.message, status: err.status });
    } finally {
      if (id === request.current) setLoading(null);
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    const id = ++request.current;
    getJson<ReflectionFeedData>(query({ tag: "", person: "" }))
      .then((data) => {
        if (alive && id === request.current) setFeed(data);
      })
      .catch((e: ApiError) => {
        if (!alive || id !== request.current) return;
        const data = e.data as Partial<ReflectionFeedData>;
        if (e.status === 401 || data?.allowed === false)
          setFeed({ allowed: false, missing: data.missing ?? ["login"], cards: [], people: [] });
        else setError({ text: e.message, status: e.status });
      })
      .finally(() => {
        if (alive && id === request.current) setLoading(null);
      });
    return () => {
      alive = false;
    };
  }, [initial]);

  function change(next: Filter) {
    setFilter(next);
    void load(next);
  }

  if (feed && !feed.allowed)
    return (
      <section className="cm-card cm-feed-locked">
        <h2>Die Reflexionen sind nur mit vollständigem Konto lesbar.</h2>
        <EligibilityChecklist
          missing={feed.missing ?? []}
          next="/reflexionen"
          purpose="feed"
        />
      </section>
    );

  const today = todayIn();
  const filtered = !!(filter.tag || filter.person);
  const cards = feed?.cards ?? [];

  return (
    <section className="cm-feed" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="cm-sr">
        Beiträge
      </h2>
      <div className="cm-card cm-feed-filters" role="search">
        <label>
          Tag
          <input
            type="date"
            max={today}
            value={filter.tag}
            onChange={(e) => change({ ...filter, tag: e.target.value })}
          />
        </label>
        <label>
          Person
          <select
            value={filter.person}
            onChange={(e) => change({ ...filter, person: e.target.value })}
          >
            <option value="">Alle Personen</option>
            {(feed?.people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => change({ tag: "", person: "" })}
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {error && (
        <div className="cm-alert error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <p>{error.text}</p>
            <button type="button" className="btn secondary" onClick={() => void load(filter)}>
              <RefreshCw size={16} aria-hidden="true" /> Erneut laden
            </button>
          </div>
        </div>
      )}

      {loading === "list" && (
        <p className="cm-loading" aria-live="polite">
          <LoaderCircle className="spin" size={18} aria-hidden="true" /> Beiträge werden geladen …
        </p>
      )}

      {!loading && feed && cards.length === 0 && !error && (
        <div className="cm-card cm-empty">
          {filtered ? (
            <>
              <h3>Für diesen Filter gibt es keine Beiträge.</h3>
              <p>Wähle einen anderen Tag oder eine andere Person.</p>
              <button
                type="button"
                className="btn secondary"
                onClick={() => change({ tag: "", person: "" })}
              >
                Alle Beiträge zeigen
              </button>
            </>
          ) : (
            <>
              <h3>Noch keine eingereichten Tagesabschlüsse.</h3>
              <p>
                Beiträge entstehen nur, wenn jemand seinen Tagesabschluss vollständig einreicht.
                Deiner kann der erste sein.
              </p>
              <Link className="btn primary" href="/tagesabschluss">
                Zum Tagesabschluss
              </Link>
            </>
          )}
        </div>
      )}

      {cards.length > 0 && (
        <div className={`cm-feed-list ${loading === "list" ? "stale" : ""}`}>
          {cards.map((card) => (
            <Card key={`${card.participant}:${card.day}`} card={card} />
          ))}
        </div>
      )}

      {feed?.next && (
        <div className="cm-more">
          <button
            type="button"
            className="btn secondary"
            disabled={loading !== null}
            onClick={() => void load(filter, feed.next ?? undefined)}
          >
            {loading === "more" && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
            Mehr laden
          </button>
        </div>
      )}
    </section>
  );
}
