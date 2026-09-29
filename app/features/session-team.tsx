"use client";
import { useId, useState } from "react";
import { UserPlus, X } from "lucide-react";
import type { Session } from "../data";

type Mutate = (action: string, value: unknown) => Promise<boolean>;

const key = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Team: Personen für eine Session vormerken, die zugesagt haben (etwa im
 * Slack oder im Discord), auch ohne eigenes Konto. Gibt es den Namen noch
 * nicht in der Rangliste, entsteht dafür ein Profil.
 */
export function SessionGuests({
  session,
  people,
  mutate,
  saving,
}: {
  session: Session;
  people: { id: string; name: string }[];
  mutate: Mutate;
  saving: boolean;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const [message, setMessage] = useState("");
  const guests = session.guests ?? [];
  const full = session.attendees >= session.capacity;
  const match = people.filter((p) => key(p.name) === key(name));

  async function add(value: { participant?: string; name?: string }) {
    setMessage("");
    const ok = await mutate("sessionGuest", { id: session.id, ...value });
    if (ok) {
      setMessage(`${match[0]?.name ?? name.trim()} ist vorgemerkt.`);
      setName("");
      setConfirmNew(false);
    }
  }

  return (
    <section className="session-team" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Vorgemerkt vom Team</h3>
      {guests.length > 0 ? (
        <ul className="session-guests">
          {guests.map((g) => (
            <li key={g.id}>
              <span>{g.name}</span>
              <button
                type="button"
                className="text-button"
                disabled={saving}
                aria-label={`${g.name} nicht mehr vormerken`}
                onClick={() => void mutate("removeSessionGuest", { id: session.id, participant: g.id })}
              >
                <X size={16} aria-hidden="true" />
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Noch niemand vorgemerkt.</p>
      )}
      <form
        className="session-guest-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return;
          if (match.length === 1) void add({ participant: match[0].id });
          else setConfirmNew(true);
        }}
      >
        <label htmlFor={`${id}-name`}>Person vormerken</label>
        <div className="session-guest-row">
          <input
            id={`${id}-name`}
            list={`${id}-people`}
            autoComplete="off"
            maxLength={60}
            placeholder="Name aus der Rangliste"
            value={name}
            disabled={full}
            onChange={(e) => {
              setName(e.target.value);
              setConfirmNew(false);
            }}
          />
          <datalist id={`${id}-people`}>
            {people.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <button className="btn secondary" disabled={saving || full || name.trim().length < 2}>
            <UserPlus size={17} aria-hidden="true" />
            Vormerken
          </button>
        </div>
        {full && <p className="hint">Alle Plätze sind belegt. Erhöhe zuerst die Plätze.</p>}
        {confirmNew && (
          <div className="session-guest-new" role="status">
            <p>
              „{name.trim()}“ steht noch nicht in der Rangliste. Dafür entsteht ein neues
              Profil, das die Person später übernehmen kann.
            </p>
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={() => void add({ name: name.trim() })}
            >
              Profil anlegen und vormerken
            </button>
          </div>
        )}
        {message && (
          <p className="hint" role="status">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}

/**
 * Raum-Link von Hand (Host oder Team), solange im Discord kein Raum per
 * Abgleich entsteht. Alle, die dabei sind, sehen dann „Zum Session-Raum“.
 */
export function SessionRoomLink({
  session,
  mutate,
  saving,
}: {
  session: Session;
  mutate: Mutate;
  saving: boolean;
}) {
  const id = useId();
  const [url, setUrl] = useState(session.roomManual ? session.room ?? "" : "");
  return (
    <form
      className="session-team session-room-form"
      onSubmit={(e) => {
        e.preventDefault();
        void mutate("sessionRoom", { id: session.id, url });
      }}
    >
      <label htmlFor={`${id}-url`}>Discord-Link zum Raum</label>
      <div className="session-guest-row">
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          maxLength={300}
          placeholder="https://discord.gg/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="btn secondary" disabled={saving || (!url.trim() && !session.roomManual)}>
          {url.trim() ? "Link speichern" : "Link entfernen"}
        </button>
      </div>
      <p className="hint">Wer dabei ist, sieht dann „Zum Session-Raum im Discord“.</p>
    </form>
  );
}
