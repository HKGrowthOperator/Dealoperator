"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, FileUp } from "lucide-react";
import {
  berlinDate,
  visibleMetrics as metrics,
  parseImport,
  type ImportRow,
} from "@/lib/kpis";
type ImportPreview = {
  key: string;
  revision: number;
  participantId: string | null;
  change: string;
  claimed?: boolean;
};
type Participant = {
  id: string;
  name: string;
  company: string;
  kind: "person" | "joint";
  claimed: boolean;
  public_consent: boolean;
};
type Contact = {
  id: string;
  name: string;
  registered: boolean;
  verified_email: string | null;
  imported_email: string | null;
  phone: string | null;
};
function template() {
  return [
    "participantKey;name;company;role;email;date;" +
      metrics.join(";") +
      ";publicConsent;kind",
    `beispiel-alex;Alex · Beispiel;Beispielfirma;Sales;;${berlinDate()};100;5;3;3;2;1;false;person`,
    `beispiel-team;Alex & Kim · Beispiel;;Gemeinsam gemeldet;;${berlinDate()};80;3;2;1;1;0;false;joint`,
  ].join("\n");
}
export default function ImportConsole({
  admin,
  signedIn,
}: {
  admin: boolean;
  signedIn: boolean;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<ImportPreview[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [invitation, setInvitation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [key, setKey] = useState("");
  async function load() {
    const r = await fetch("/api/operator");
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setParticipants(d.participants || []);
    setContacts(d.contacts || []);
  }
  useEffect(() => {
    if (!admin) return;
    const c = new AbortController();
    fetch("/api/operator", { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (c.signal.aborted) return;
        setParticipants(d.participants || []);
        setContacts(d.contacts || []);
      })
      .catch((e) => {
        if (!c.signal.aborted) setMessage(e.message);
      });
    return () => c.abort();
  }, [admin]);
  async function action(data: unknown) {
    const r = await fetch("/api/operator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function check() {
    setBusy(true);
    setMessage("");
    setSuccess("");
    setRows([]);
    setPreview([]);
    setConfirmed(false);
    try {
      const parsed = parseImport(text);
      if (admin) {
        const d = await action({ action: "previewImport", text });
        setRows(d.rows);
        setPreview(d.preview);
      } else {
        setRows(parsed);
        setPreview(
          parsed.map((r) => ({
            key: `${r.participantKey}:${r.date}`,
            change: "Nur lokale Vorschau",
            revision: 0,
            participantId: null,
          })),
        );
      }
      setKey(crypto.randomUUID());
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setMessage("");
    try {
      const d = await action({
        action: "commitImport",
        value: { rows, key, expected: preview },
      });
      setSuccess(
        `${d.count} Tagesmeldungen gespeichert. Freigegebene Zahlen erscheinen im Ranking.`,
      );
      setRows([]);
      setPreview([]);
      setConfirmed(false);
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + template()], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "deal-operator-import-vorlage.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="admin-layout">
      <span className="section-kicker">DEAL OPERATOR · VERWALTUNG</span>
      {admin ? (
        <>
          <h1>Aus ersten Zahlen wird Fortschritt.</h1>
          <p>
            Teilnehmer vorbereiten, Tagesstände prüfen und später sicher an
            ihre Konten übergeben.
          </p>
        </>
      ) : (
        <>
          <h1>Bereich für das Deal-Operator-Team.</h1>
          <p>Hier werden gemeldete Tagesstände geprüft.</p>
        </>
      )}
      {!admin && (
        <div className="notice">
          <strong>Import-Vorschau</strong>
          <p>
            Du kannst Dateien prüfen und die Vorschau ausprobieren. Es wird
            dabei nichts gespeichert oder veröffentlicht. Für echte Importe ist
            ein freigeschaltetes Verwaltungskonto nötig.
          </p>
          {!signedIn && (
            <Link className="text-link" href="/starten?next=/verwaltung">
              Als Verwaltung anmelden
            </Link>
          )}
        </div>
      )}
      <section className="card">
        <h2>1. Daten einfügen</h2>
        <p className="hint">
          Die feste participantKey ordnet spätere Meldungen derselben Person zu.
          Leere Kennzahlen bleiben unbekannt. Allgemeine alte Termine gehören in
          legacyMeetings. publicConsent bleibt false, bis die Veröffentlichung
          mit der Person geklärt ist. kind steht auf <code>person</code> für
          genau eine Person und auf <code>joint</code> für eine gemeinsam
          gemeldete Leistung mehrerer Personen. Eine gemeinsame Meldung zählt
          einmal zur Gesamtleistung, tritt aber in keiner persönlichen
          Rangliste an und lässt sich nicht als Konto übernehmen.
        </p>
        <div className="admin-actions">
          <button className="btn secondary" onClick={download}>
            <Download size={17} />
            CSV-Vorlage
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              setText(template());
              setRows([]);
              setPreview([]);
              setSuccess("");
              setConfirmed(false);
            }}
          >
            Mit Beispiel füllen
          </button>
          <label className="btn secondary">
            <FileUp size={17} />
            CSV / JSON auswählen
            <input
              aria-label="CSV- oder JSON-Datei auswählen"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 250000) {
                  setMessage("Bitte maximal 250 KB pro Import verwenden.");
                  return;
                }
                setText(await f.text());
                setRows([]);
                setPreview([]);
                setSuccess("");
                setConfirmed(false);
              }}
            />
          </label>
        </div>
        <label className="form-stack">
          Tagesmeldungen als CSV oder JSON
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRows([]);
              setPreview([]);
              setSuccess("");
              setConfirmed(false);
            }}
            spellCheck={false}
            placeholder="CSV aus der Vorlage hier einfügen …"
          />
        </label>
        <div className="admin-actions">
          <button
            className="btn primary"
            disabled={!text.trim() || busy}
            onClick={check}
          >
            {busy ? "Wird geprüft …" : "Daten prüfen & Vorschau öffnen"}
          </button>
        </div>
        {message && (
          <p role="alert" className="form-error">
            {message}
          </p>
        )}
        {success && (
          <p role="status" className="notice">
            {success}
          </p>
        )}
      </section>
      {rows.length > 0 && (
        <section className="card">
          <h2>2. Änderungen prüfen</h2>
          <div className="import-preview">
            <table>
              <thead>
                <tr>
                  <th>Teilnehmer</th>
                  <th>Tag</th>
                  <th>Calls</th>
                  <th>Settings</th>
                  <th>Sichtbarkeit</th>
                  <th>Änderung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.participantKey}:${r.date}`}>
                    <td>
                      {r.name}
                      <small> · {r.participantKey}</small>
                    </td>
                    <td>{r.date}</td>
                    <td>{r.counts.attempts ?? "—"}</td>
                    <td>{r.counts.settingsBooked ?? "—"}</td>
                    <td>
                      {preview[i]?.claimed
                        ? "Einstellung des Mitglieds bleibt bestehen"
                        : r.publicConsent
                          ? "Im öffentlichen Ranking"
                          : "Privat"}
                    </td>
                    <td>{preview[i]?.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="notice">
            Ein Import ersetzt den vollständigen Tagesstand. Er wird nicht zum
            bisherigen Stand addiert. Kontaktfelder sind nur für die Verwaltung
            und die Zuordnung bestimmt.
          </div>
          <label className="admin-field-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Ich habe Zuordnung, Zahlen und Freigaben geprüft.
          </label>
          <button
            className="btn primary"
            onClick={commit}
            disabled={!admin || !confirmed || busy}
          >
            <Check size={17} />
            {admin
              ? "Geprüfte Tagesstände speichern"
              : "Speichern nach Freischaltung verfügbar"}
          </button>
        </section>
      )}
      {admin && (
        <section className="card">
          <h2>3. Profile sicher übergeben</h2>
          {!participants.length ? (
            <p>Noch keine Teilnehmer importiert.</p>
          ) : (
            participants.map((p) => (
              <div className="admin-field-row" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.kind === "joint"
                      ? "Gemeinsame Meldung · kein Einzelrang"
                      : p.company || "Einzelprofil"}{" "}
                    ·{" "}
                    {p.claimed ? "Profil übernommen" : "Noch nicht übernommen"}{" "}
                    · {p.public_consent ? "Ranking sichtbar" : "Privat"}
                  </small>
                </div>
                {!p.claimed && p.kind !== "joint" && (
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const d = await action({
                          action: "issueClaim",
                          id: p.id,
                        });
                        setInvitation(
                          `Deine Zahlen aus dem gemeinsamen Callen stehen im Ranking von Deal Operator. Wenn du deine Zahlen künftig selbst eintragen möchtest (freiwillig), frag hier die Übernahme an: ${window.location.origin}/profil-uebernehmen?profil=${encodeURIComponent(p.id)}&einladung=${encodeURIComponent(d.token)}\nDer Link ist 7 Tage gültig und nur für dich, bitte nicht weitergeben. Das Team prüft die Anfrage und gibt das Profil danach frei.`,
                        );
                      } catch (e) {
                        setMessage((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Einmalcode erstellen
                  </button>
                )}
              </div>
            ))
          )}
          {invitation && (
            <div className="admin-code">
              <p>
                Diese Einladung persönlich an die zugehörige Person weitergeben.
                Ein neuer Code ersetzt den bisherigen.
              </p>
              <textarea
                aria-label="Persönliche Einladung"
                readOnly
                value={invitation}
              />
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invitation);
                    setSuccess("Einladung kopiert.");
                  } catch {
                    setMessage(
                      "Bitte die Einladung im Textfeld markieren und kopieren.",
                    );
                  }
                }}
              >
                <Copy size={16} />
                Einladung kopieren
              </button>
            </div>
          )}
        </section>
      )}
      {admin && (
        <section className="card">
          <h2>Mitglieder & private Kontaktdaten</h2>
          <p className="hint">
            Nur für die Verwaltung. Die bestätigte Konto-E-Mail ist von einer
            vorab importierten Adresse getrennt. Eine Anmeldung löst keine
            Werbe- oder Vertriebskampagne aus.
          </p>
          <div className="import-preview">
            <table>
              <thead>
                <tr>
                  <th>Mitglied</th>
                  <th>Status</th>
                  <th>E-Mail</th>
                  <th>Telefon · nicht verifiziert</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>
                      {c.registered ? "Konto verbunden" : "Profil vorbereitet"}
                    </td>
                    <td>
                      {c.verified_email || c.imported_email || "—"}
                      {c.verified_email
                        ? " · bestätigt"
                        : c.imported_email
                          ? " · importiert"
                          : ""}
                    </td>
                    <td>{c.phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
