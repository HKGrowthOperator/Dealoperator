"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Video,
  Plus,
  Users,
  Clock,
  Check,
  LoaderCircle,
} from "lucide-react";
import type { Session, AppData } from "../data";
import { call } from "./flow-parts";
import { PushPrompt } from "./push-setup";
import { zonedTime } from "@/lib/commitment";
import type { DirectoryMember } from "@/lib/members";

export default function CallsHub({
  initial,
  target,
}: {
  initial: Pick<AppData, "sessions" | "callUrl">;
  target: DirectoryMember | null;
}) {
  const [sessions, setSessions] = useState(initial.sessions),
    [form, setForm] = useState(!!target),
    [filter, setFilter] = useState("Alle"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [created, setCreated] = useState("");
  const [v, setV] = useState({
    title: target ? `Zusammenarbeit mit ${target.name}` : "",
    kind: "Roleplay",
    date: "",
    time: "",
    minutes: 45,
    capacity: 12,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const upcoming = sessions
    .filter(
      (s) =>
        !s.cancelled &&
        new Date(s.startsAt || `${s.date}T${s.time}`).getTime() +
          s.minutes * 60000 >
          now,
    )
    .sort((a, b) =>
      (a.startsAt || a.date + a.time).localeCompare(
        b.startsAt || b.date + b.time,
      ),
    );
  async function refresh() {
    const d = await call<AppData>("/api/community");
    setSessions(d.sessions);
  }
  async function join(s: Session) {
    setBusy(s.id);
    setError("");
    try {
      await call("/api/community", { action: "rsvp", value: s.id });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError("");
    try {
      const [h, m] = v.time.split(":").map(Number);
      const startsAt = zonedTime(v.date, h, m, "Europe/Berlin").toISOString();
      const result = await call<{ id: string }>("/api/community", {
        action: "session",
        value: { ...v, startsAt },
      });
      setCreated(result.id);
      setForm(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <main id="inhalt" className="mn-page">
      <header className="mn-heading">
        <div>
          <p className="mn-eyebrow">Zusammen üben & umsetzen</p>
          <h1>
            Ein Termin.
            <br />
            <span>Ein gemeinsamer Schritt.</span>
          </h1>
          <p>Roleplay, Call-Block oder Austausch zu einem Projekt.</p>
        </div>
        <button className="btn primary" onClick={() => setForm(!form)}>
          <Plus size={18} />
          Call verabreden
        </button>
      </header>
      <section className="mn-call-room">
        <div>
          <Video size={23} />
          <div>
            <h2>Gemeinsamer Call-Raum</h2>
            <p>Für spontane Gespräche und eure verabredeten Calls.</p>
          </div>
        </div>
        <a
          className="btn secondary"
          href={initial.callUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Raum öffnen
        </a>
      </section>
      {target && (
        <div className="mn-section">
          <h2>Dein Austausch mit {target.name}</h2>
          <p>{target.headline}</p>
          {created && target.contactEmail && (
            <a
              className="btn primary"
              href={`mailto:${target.contactEmail}?subject=${encodeURIComponent(v.title)}&body=${encodeURIComponent(`Lass uns am ${v.date} um ${v.time} Uhr sprechen. Hier kannst du zusagen: ${window.location.origin}/sessions?modus=eigen&call=${created}`)}`}
            >
              {target.name} zum Termin einladen
            </a>
          )}
          <Link
            className="mn-back"
            href={`/mitglieder/${encodeURIComponent(target.id)}`}
          >
            Zum Profil
          </Link>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {created && (
        <div className="mn-section mn-section-tint" role="status">
          <h2>Dein Call steht.</h2>
          <p>Die anderen können jetzt zusagen.</p>
          <button
            className="btn secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/sessions?modus=eigen&call=${created}`,
                );
              } catch {
                setError(
                  "Der Link konnte nicht kopiert werden. Öffne den Termin und kopiere die Adresse.",
                );
              }
            }}
          >
            Einladungslink kopieren
          </button>
        </div>
      )}
      {form && (
        <form className="mn-section mn-edit-form" onSubmit={create}>
          <h2>Was habt ihr vor?</h2>
          <label>
            Titel
            <input
              required
              minLength={4}
              maxLength={100}
              value={v.title}
              onChange={(e) => setV({ ...v, title: e.target.value })}
              placeholder="Einwände üben oder gemeinsam callen"
            />
          </label>
          <div className="mn-field-row">
            <label>
              Art
              <select
                value={v.kind}
                onChange={(e) => setV({ ...v, kind: e.target.value })}
              >
                {["Roleplay", "Call-Block", "Reflexion"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Plätze
              <input
                type="number"
                min={2}
                max={25}
                required
                value={v.capacity}
                onChange={(e) =>
                  setV({ ...v, capacity: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <div className="mn-field-row">
            <label>
              Datum
              <input
                type="date"
                required
                value={v.date}
                onChange={(e) => setV({ ...v, date: e.target.value })}
              />
            </label>
            <label>
              Uhrzeit · Berlin
              <input
                type="time"
                required
                value={v.time}
                onChange={(e) => setV({ ...v, time: e.target.value })}
              />
            </label>
            <label>
              Dauer
              <select
                value={v.minutes}
                onChange={(e) =>
                  setV({ ...v, minutes: Number(e.target.value) })
                }
              >
                {[15, 30, 45, 60, 90, 120].map((x) => (
                  <option key={x} value={x}>
                    {x} Minuten
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mn-actions">
            <button className="btn primary" disabled={!!busy}>
              {busy === "create" && <LoaderCircle size={17} className="spin" />}
              Termin anlegen
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setForm(false)}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
      <nav className="mn-filters mn-call-tabs" aria-label="Calls filtern">
        {["Alle", "Meine Calls", "Roleplay", "Call-Block", "Reflexion"].map(
          (f) => (
            <button
              key={f}
              className={`mn-filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f}
            </button>
          ),
        )}
      </nav>
      <div className="mn-call-list">
        {upcoming
          .filter(
            (s) =>
              filter === "Alle" ||
              (filter === "Meine Calls" && s.joined) ||
              s.kind === filter,
          )
          .map((s) => (
            <article className="mn-call-card" key={s.id}>
              <div className="mn-call-date">
                <CalendarDays size={19} />
                <strong>
                  {new Date(
                    s.startsAt || `${s.date}T${s.time}`,
                  ).toLocaleDateString("de-DE", {
                    timeZone: "Europe/Berlin",
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </strong>
                <span>{s.time} Uhr</span>
              </div>
              <div className="mn-call-main">
                <span className="mn-eyebrow">{s.kind}</span>
                <h2>{s.title}</h2>
                <p>Mit {s.host}</p>
                <div className="mn-call-meta">
                  <span>
                    <Clock size={15} />
                    {s.minutes} Min.
                  </span>
                  <span>
                    <Users size={15} />
                    {s.attendees} von {s.capacity} dabei
                  </span>
                </div>
                {s.roster && s.roster.length > 0 && (
                  <p className="mn-roster">
                    {s.roster.map((r) => r.name).join(", ")}
                  </p>
                )}
              </div>
              <div className="mn-call-actions">
                {s.joined ? (
                  <>
                    <span className="mn-success">
                      <Check size={17} />
                      Du bist dabei
                    </span>
                    <a
                      className="btn primary"
                      href={`/call/${encodeURIComponent(s.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Video size={17} />
                      Zum Call
                    </a>
                    <button
                      className="mn-back"
                      disabled={!!busy}
                      onClick={() => void join(s)}
                    >
                      Absagen
                    </button>
                  </>
                ) : (
                  <button
                    className="btn primary"
                    disabled={!!busy || s.attendees >= s.capacity}
                    onClick={() => void join(s)}
                  >
                    {busy === s.id ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : null}
                    {s.attendees >= s.capacity ? "Ausgebucht" : "Ich bin dabei"}
                  </button>
                )}
                <Link
                  className="mn-back"
                  href={`/sessions?modus=eigen&call=${encodeURIComponent(s.id)}`}
                >
                  Termindetails
                </Link>
              </div>
            </article>
          ))}
      </div>
      {!upcoming.length && (
        <section className="mn-empty">
          <CalendarDays size={30} />
          <h2>Wann wollt ihr loslegen?</h2>
          <p>
            Verabrede den nächsten Call oder finde zuerst jemanden für dein
            Thema.
          </p>
          <button className="btn primary" onClick={() => setForm(true)}>
            Ersten Call verabreden
          </button>
          <Link href="/mitglieder" className="btn secondary">
            Mitglieder finden
          </Link>
        </section>
      )}
      {sessions.some((s) => s.joined && !s.cancelled) && (
        <PushPrompt variant="call" />
      )}
    </main>
  );
}
