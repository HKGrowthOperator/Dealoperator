"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, Check, LoaderCircle } from "lucide-react";
import type { MemberOffer, MemberOfferInput } from "@/lib/members";
import { NetworkTabs, MemberPhoto } from "./member-directory";
import { call } from "./flow-parts";

const empty: MemberOfferInput = {
  title: "",
  description: "",
  category: "Auftrag weitergeben",
  industry: "",
};
export default function MemberOffers({ initial }: { initial: MemberOffer[] }) {
  const [offers, setOffers] = useState(initial),
    [query, setQuery] = useState(""),
    [mine, setMine] = useState(false);
  const [form, setForm] = useState(false),
    [value, setValue] = useState(empty),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const shown = useMemo(
    () =>
      offers.filter(
        (o) =>
          (!mine || o.member.mine) &&
          (!o.closed || mine) &&
          `${o.title} ${o.description} ${o.industry} ${o.member.name}`
            .toLocaleLowerCase("de")
            .includes(query.toLocaleLowerCase("de").trim()),
      ),
    [offers, mine, query],
  );
  async function change(action: "save" | "close" | "delete", payload: unknown) {
    setBusy(action);
    setError("");
    try {
      await call("/api/members", { action: `offer-${action}`, value: payload });
      const data = await call<{ offers: MemberOffer[] }>(
        "/api/members?offers=1",
      );
      setOffers(data.offers);
      if (action === "save") {
        setForm(false);
        setValue(empty);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <main id="inhalt" className="mn-page nw-directory">
      <NetworkTabs active="offers" />
      <header className="mn-heading">
        <div>
          <p className="mn-eyebrow">Weitergeben & zusammenarbeiten</p>
          <h1>
            Angebote<span>.</span>
          </h1>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setForm(!form);
            setError("");
          }}
          aria-expanded={form}
        >
          <Plus size={18} />
          Angebot einstellen
        </button>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {form && (
        <form
          className="mn-section nw-offer-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void change("save", value);
          }}
        >
          <h2>
            {value.id ? "Angebot bearbeiten" : "Was möchtest du weitergeben?"}
          </h2>
          <label>
            Titel
            <input
              required
              minLength={3}
              maxLength={100}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
              placeholder="Recruiting-Auftrag für einen Handwerksbetrieb"
            />
          </label>
          <div className="mn-field-row">
            <label>
              Art
              <select
                value={value.category}
                onChange={(e) =>
                  setValue({
                    ...value,
                    category: e.target.value as MemberOfferInput["category"],
                  })
                }
              >
                {[
                  "Auftrag weitergeben",
                  "Zusammenarbeit",
                  "Freie Kapazitäten",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Branche
              <input
                maxLength={100}
                value={value.industry}
                onChange={(e) =>
                  setValue({ ...value, industry: e.target.value })
                }
                placeholder="Zum Beispiel Handwerk"
              />
            </label>
          </div>
          <label>
            Worum geht es?
            <textarea
              required
              minLength={20}
              maxLength={1600}
              rows={5}
              value={value.description}
              onChange={(e) =>
                setValue({ ...value, description: e.target.value })
              }
              placeholder="Was wird gebraucht, was ist bereits da und wer würde gut dazu passen?"
            />
          </label>
          <div className="nw-form-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => setForm(false)}
            >
              Abbrechen
            </button>
            <button className="btn primary" disabled={!!busy}>
              {busy === "save" && <LoaderCircle className="spin" size={18} />}
              {value.id ? "Änderungen speichern" : "Veröffentlichen"}
            </button>
          </div>
        </form>
      )}
      <div className="nw-searchbar">
        <label className="mn-search">
          <Search size={21} />
          <span className="sr-only">Angebote suchen</span>
          <input
            type="search"
            placeholder="Auftrag, Branche oder Mitglied"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={`mn-filter ${mine ? "active" : ""}`}
          aria-pressed={mine}
          onClick={() => setMine(!mine)}
        >
          Meine Angebote
        </button>
      </div>
      <p className="mn-results" role="status">
        {shown.length} {shown.length === 1 ? "Angebot" : "Angebote"}
      </p>
      <div className="nw-offers">
        {shown.map((o) => (
          <article className="nw-offer" key={o.id}>
            <div className="nw-offer-meta">
              <span>
                {o.category}
                {o.industry && ` · ${o.industry}`}
              </span>
              <time dateTime={o.createdAt}>
                {new Date(o.createdAt).toLocaleDateString("de-DE", {
                  day: "numeric",
                  month: "short",
                  timeZone: "Europe/Berlin",
                })}
              </time>
            </div>
            <h2>{o.title}</h2>
            <p className="mn-lines">{o.description}</p>
            <footer>
              <Link
                className="nw-offer-author"
                href={`/mitglieder/${encodeURIComponent(o.member.id)}`}
              >
                <MemberPhoto member={o.member} />
                <div>
                  <strong>{o.member.name}</strong>
                  <small>{o.member.headline}</small>
                </div>
              </Link>
              <Link
                className="btn secondary"
                href={`/mitglieder/${encodeURIComponent(o.member.id)}`}
              >
                Kontakt aufnehmen
              </Link>
            </footer>
            {o.member.mine && (
              <div className="nw-offer-owner">
                <button
                  className="mn-back"
                  disabled={!!busy}
                  onClick={() => {
                    setValue({
                      id: o.id,
                      title: o.title,
                      description: o.description,
                      category: o.category,
                      industry: o.industry,
                    });
                    setForm(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Bearbeiten
                </button>
                {o.closed ? (
                  <span className="mn-success">
                    <Check size={15} />
                    Erledigt
                  </span>
                ) : (
                  <button
                    className="mn-back"
                    disabled={!!busy}
                    onClick={() => void change("close", { id: o.id })}
                  >
                    Als erledigt markieren
                  </button>
                )}
                <button
                  className="mn-back"
                  disabled={!!busy}
                  onClick={() => void change("delete", { id: o.id })}
                >
                  Entfernen
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!shown.length && (
        <section className="mn-empty">
          <h2>
            {query
              ? "Dazu gibt es noch kein Angebot."
              : mine
                ? "Hier stehen deine Angebote."
                : "Ein Auftrag sucht die richtige Person?"}
          </h2>
          <p>
            {mine
              ? "Stelle einen Auftrag oder eine Möglichkeit zur Zusammenarbeit ein."
              : "Stelle ihn ein. Die passenden Mitglieder können sich direkt bei dir melden."}
          </p>
          <button className="btn primary" onClick={() => setForm(true)}>
            <Plus size={18} />
            Angebot einstellen
          </button>
        </section>
      )}
    </main>
  );
}
