"use client";
import { useState } from "react";
import { ClipboardPaste, RefreshCw, UserSearch } from "lucide-react";
import { berlinDate, metricLabels, type Metric } from "@/lib/kpis";
import { formatDay } from "@/lib/ranking-history";
import {
  AdminError,
  Badge,
  Feedback,
  ProfilePicker,
  adminPost,
  suggestedProfile,
  formatDateTime,
  newKey,
  type Participant,
  type ReviewCase,
  type Tone,
  type WinsAction,
  type WinsPreview,
  type WinsRow,
} from "./admin-shared";

const ACTIONS: { id: WinsAction; label: string; tone: Tone; hint: string }[] =
  [
    {
      id: "neu",
      label: "Neu",
      tone: "ok",
      hint: "Für diese Person und diesen Tag gibt es noch keinen Stand.",
    },
    {
      id: "korrektur",
      label: "Korrektur",
      tone: "action",
      hint: "Der gespeicherte Stand ändert sich bei den markierten Kennzahlen.",
    },
    {
      id: "prüffall",
      label: "Prüffall",
      tone: "warn",
      hint: "Nicht eindeutig. Wird beim Übernehmen als Prüffall angelegt und nicht gezählt.",
    },
    {
      id: "übersprungen",
      label: "Übersprungen",
      tone: "muted",
      hint: "Wird nicht überschrieben, zum Beispiel ein eigener Tagesabschluss.",
    },
    {
      id: "ersetzt",
      label: "Ersetzt",
      tone: "muted",
      hint: "Früherer Zwischenstand derselben Person. Eine spätere Meldung gilt, nichts wird addiert.",
    },
    {
      id: "unverändert",
      label: "Unverändert",
      tone: "neutral",
      hint: "Der Stand stimmt schon überein.",
    },
  ];
const actionInfo = (id: WinsAction) =>
  ACTIONS.find((a) => a.id === id) ?? ACTIONS[0];
const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("de-DE");

type PreviewState = WinsPreview & { text: string; day: string; key: string };
type CommitResult = {
  ok: boolean;
  written: number;
  cases: number;
  unchanged: number;
  skipped: number;
};

/**
 * Tägliche Wins-Meldungen einfügen, Vorschau mit Vorher/Nachher prüfen und
 * übernehmen. Ein wiederholtes Übernehmen desselben Textes ändert nichts:
 * dieselbe Vorschau schickt denselben Schlüssel, und eine neue Vorschau
 * zeigt die bereits gespeicherten Stände als unverändert.
 */
export function WinsImport({ onCommitted }: { onCommitted: () => void }) {
  const [text, setText] = useState("");
  const [day, setDay] = useState(() => berlinDate());
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [filter, setFilter] = useState<WinsAction | "alle">("alle");
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const stale = !!preview && (preview.text !== text || preview.day !== day);
  const writable = preview
    ? preview.rows.filter(
        (r) => (r.action === "neu" || r.action === "korrektur") && r.key,
      )
    : [];
  const newCases = preview?.summary.prüffall ?? 0;
  const shown = preview
    ? preview.rows.filter((r) => filter === "alle" || r.action === filter)
    : [];

  async function runPreview(keepResult = false) {
    setBusy("preview");
    setError("");
    setConflict(false);
    if (!keepResult) setResult(null);
    try {
      const data = await adminPost<WinsPreview>("previewWins", { text, day });
      setPreview({ ...data, text, day, key: newKey() });
      setFilter("alle");
    } catch (e) {
      setPreview(null);
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function commit() {
    if (!preview || stale) return;
    setBusy("commit");
    setError("");
    setConflict(false);
    try {
      const data = await adminPost<CommitResult>("commitWins", {
        text: preview.text,
        day: preview.day,
        key: preview.key,
        expected: writable.map((r) => ({ key: r.key!, revision: r.revision })),
      });
      setResult(data);
      onCommitted();
      // Neue Vorschau zeigt den gespeicherten Stand: alles unverändert.
      setBusy("");
      await runPreview(true);
    } catch (e) {
      setError((e as Error).message);
      setConflict(e instanceof AdminError && e.status === 409);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="adm-card" aria-labelledby="adm-wins-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <ClipboardPaste size={19} />
        </span>
        <div>
          <h2 id="adm-wins-title">Wins-Import</h2>
          <p>
            Tägliche Meldungen einfügen, Vorschau prüfen, dann übernehmen. Eine
            Meldung ist ein Stand, kein Zuwachs: je Person und Leistungstag
            gilt die späteste Meldung. Termine ohne Typangabe werden nie zu
            Settings oder Closings. Der eingefügte Text wird nicht gespeichert.
          </p>
        </div>
      </div>
      <div className="adm-form">
        <label className="adm-field adm-field-narrow">
          <span>Leistungstag</span>
          <input
            type="date"
            value={day}
            max={berlinDate()}
            onChange={(e) => setDay(e.target.value)}
          />
          <small>
            Gilt, wenn im Text kein Datum steht. Datum und Uhrzeit der
            Nachricht werden berücksichtigt.
          </small>
        </label>
        <label className="adm-field">
          <span>Meldungen</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={
              "Kopierter Verlauf mit Datum und Uhrzeit, Slack-Kopfzeilen (Name und Uhrzeit) oder Zeilen wie\nName: 120 Anwahlen, 3 Settings, 1 Closing"
            }
          />
        </label>
        <div className="adm-actions">
          <button
            className="btn primary"
            disabled={!text.trim() || !day || busy !== ""}
            onClick={() => runPreview()}
          >
            {busy === "preview" ? (
              <RefreshCw size={16} className="spin" />
            ) : null}
            {preview && !stale ? "Vorschau neu erstellen" : "Vorschau erstellen"}
          </button>
          {text && (
            <button
              className="btn secondary"
              disabled={busy !== ""}
              onClick={() => {
                setText("");
                setPreview(null);
                setResult(null);
                setError("");
              }}
            >
              Leeren
            </button>
          )}
        </div>
      </div>
      <Feedback error={error} />
      {conflict && (
        <div className="adm-actions">
          <button className="btn secondary" onClick={() => runPreview()}>
            Vorschau neu laden
          </button>
        </div>
      )}
      {result && (
        <p className="adm-feedback" data-tone="ok" role="status">
          Übernommen: {fmt(result.written)}{" "}
          {result.written === 1 ? "Tagesstand" : "Tagesstände"} geschrieben,{" "}
          {fmt(result.cases)} {result.cases === 1 ? "neuer Prüffall" : "neue Prüffälle"},{" "}
          {fmt(result.unchanged)} unverändert, {fmt(result.skipped)}{" "}
          übersprungen. Die Vorschau unten zeigt den gespeicherten Stand.
        </p>
      )}
      {preview && (
        <div className="adm-preview" aria-live="polite">
          {stale && (
            <p className="adm-feedback" data-tone="warn">
              Text oder Leistungstag wurden geändert. Erstelle die Vorschau neu,
              bevor du übernimmst.
            </p>
          )}
          <div
            className="adm-summary"
            role="group"
            aria-label="Zusammenfassung nach Aktion"
          >
            <button
              aria-pressed={filter === "alle"}
              onClick={() => setFilter("alle")}
            >
              Alle <strong>{fmt(preview.rows.length)}</strong>
            </button>
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                data-tone={a.tone}
                aria-pressed={filter === a.id}
                disabled={!preview.summary[a.id]}
                onClick={() => setFilter(a.id)}
              >
                {a.label} <strong>{fmt(preview.summary[a.id] ?? 0)}</strong>
              </button>
            ))}
          </div>
          {preview.rows.length === 0 ? (
            <p className="adm-empty">
              Im Text wurde keine Meldung erkannt. Prüfe, ob Name und Zahlen in
              einer Zeile stehen.
            </p>
          ) : (
            <ul className="adm-list">
              {shown.map((row, index) => (
                <WinsRowCard key={`${row.key ?? row.author}-${index}`} row={row} />
              ))}
            </ul>
          )}
          <div className="adm-commit">
            <p>
              {writable.length
                ? `${writable.length} ${writable.length === 1 ? "Tagesstand wird" : "Tagesstände werden"} geschrieben.`
                : "Keine neuen oder geänderten Tagesstände."}{" "}
              {newCases
                ? `${newCases} ${newCases === 1 ? "Prüffall wird" : "Prüffälle werden"} angelegt, sofern noch nicht vorhanden.`
                : ""}
            </p>
            <button
              className="btn primary"
              disabled={
                stale || busy !== "" || (!writable.length && !newCases)
              }
              onClick={commit}
            >
              {busy === "commit" ? (
                <RefreshCw size={16} className="spin" />
              ) : null}
              Übernehmen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function WinsRowCard({ row }: { row: WinsRow }) {
  const info = actionInfo(row.action);
  const metrics: Metric[] =
    row.action === "neu" || row.action === "korrektur"
      ? row.changed
      : (Object.keys(row.after || {}) as Metric[]);
  return (
    <li className="adm-item adm-win" data-action={row.action}>
      <div className="adm-item-head">
        <Badge tone={info.tone}>{info.label}</Badge>
        <span className="adm-meta">
          {formatDay(row.day)}
          {row.time ? `, ${row.time} Uhr` : ""}
        </span>
      </div>
      <h3>
        {row.participantName || row.author}
        {row.participantName && row.participantName !== row.author && (
          <small> gemeldet als „{row.author}“</small>
        )}
      </h3>
      <p className="adm-hint">{info.hint}</p>
      {metrics.length > 0 && (
        <dl className="adm-diff">
          {metrics.map((m) => {
            const before = row.before?.[m];
            const after = row.after?.[m];
            const changed = row.changed.includes(m);
            return (
              <div key={m} data-changed={changed}>
                <dt>{metricLabels[m]}</dt>
                <dd>
                  {row.action === "neu" || row.action === "korrektur" ? (
                    <>
                      <span className="adm-before">{fmt(before)}</span>
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only"> wird zu </span>
                      <strong>{fmt(after)}</strong>
                    </>
                  ) : (
                    <strong>{fmt(after)}</strong>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {row.reasons.length > 0 && (
        <ul className="adm-reasons">
          {row.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {row.notes.length > 0 && (
        <ul className="adm-notes">
          {row.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {row.excerpt && (
        <details className="adm-excerpt">
          <summary>Auszug der Meldung</summary>
          <p>{row.excerpt}</p>
        </details>
      )}
    </li>
  );
}

/**
 * Prüffälle aus dem Wins-Import: einem Profil als Alias zuordnen oder
 * verwerfen. Nach einer Zuordnung wird dieselbe Meldung beim nächsten
 * Import normal übernommen.
 */
export function ReviewCases({
  cases,
  participants,
  onChanged,
  onImport,
}: {
  cases: ReviewCase[];
  participants: Participant[];
  onChanged: () => void;
  onImport: () => void;
}) {
  const open = cases.filter((c) => c.status === "open");
  const closed = cases.filter((c) => c.status !== "open");
  const [notice, setNotice] = useState("");
  return (
    <section className="adm-card" aria-labelledby="adm-cases-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <UserSearch size={19} />
        </span>
        <div>
          <h2 id="adm-cases-title">Prüffälle</h2>
          <p>
            Meldungen, die sich nicht eindeutig einer Person oder Kennzahl
            zuordnen ließen. „Als Alias zuordnen“ merkt sich den gemeldeten
            Namen für dieses Profil. Füge den Text danach im Wins-Import erneut
            ein, dann wird die Meldung normal übernommen.
          </p>
        </div>
      </div>
      {notice && (
        <div className="adm-actions">
          <Feedback success={notice} />
          {notice.startsWith("Zugeordnet") && (
            <button className="btn secondary" onClick={onImport}>
              Zum Wins-Import
            </button>
          )}
        </div>
      )}
      {open.length ? (
        <ul className="adm-list">
          {open.map((c) => (
            <CaseCard
              key={c.id}
              item={c}
              participants={participants}
              onResolved={(message) => {
                setNotice(message);
                onChanged();
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="adm-empty">Keine offenen Prüffälle.</p>
      )}
      {closed.length > 0 && (
        <details className="adm-done">
          <summary>Erledigte Prüffälle ({closed.length})</summary>
          <ul className="adm-list">
            {closed.map((c) => (
              <li key={c.id} className="adm-item" data-resolved="true">
                <div className="adm-item-head">
                  <Badge tone="muted">
                    {c.status === "resolved" ? "Zugeordnet" : "Verworfen"}
                  </Badge>
                  <span className="adm-meta">{formatDay(c.day)}</span>
                </div>
                <h3>„{c.name_seen}“</h3>
                {c.reason && <p className="adm-hint">{c.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CaseCard({
  item,
  participants,
  onResolved,
}: {
  item: ReviewCase;
  participants: Participant[];
  onResolved: (message: string) => void;
}) {
  // Enthält der Prüfgrund einen eindeutigen Vorschlag, ist er vorausgewählt.
  const [suggested] = useState(() =>
    suggestedProfile(item.reason, participants),
  );
  const [target, setTarget] = useState(suggested);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function resolve(decision: "alias" | "dismiss") {
    setBusy(decision);
    setError("");
    try {
      await adminPost("resolveCase", {
        id: item.id,
        decision,
        ...(decision === "alias" ? { participantId: target } : {}),
      });
      const name = participants.find((p) => p.id === target)?.name;
      onResolved(
        decision === "alias"
          ? `Zugeordnet: „${item.name_seen}“ gehört jetzt zu ${name ?? "dem gewählten Profil"}. Füge den Text im Wins-Import erneut ein, um die Meldung zu übernehmen.`
          : `Verworfen: „${item.name_seen}“.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <li className="adm-item">
      <div className="adm-item-head">
        <Badge tone="warn">Offen</Badge>
        <span className="adm-meta">
          Leistungstag {formatDay(item.day)} · angelegt{" "}
          {formatDateTime(item.created_at)}
        </span>
      </div>
      <h3>Gemeldet als „{item.name_seen}“</h3>
      {item.reason && <p className="adm-hint">{item.reason}</p>}
      {item.excerpt && (
        <details className="adm-excerpt">
          <summary>Auszug der Meldung</summary>
          <p>{item.excerpt}</p>
        </details>
      )}
      <div className="adm-case-form">
          <ProfilePicker
            participants={participants}
            value={target}
            onChange={setTarget}
          />
          {suggested && target === suggested && (
            <p className="adm-hint">
              Vorschlag aus dem Prüfgrund ist vorausgewählt. Bitte prüfen.
            </p>
          )}
          <div className="adm-actions">
            <button
              className="btn primary"
              disabled={!target || busy !== ""}
              onClick={() => resolve("alias")}
            >
              Als Alias zuordnen
            </button>
            <button
              className="btn secondary"
              disabled={busy !== ""}
              onClick={() => resolve("dismiss")}
            >
              Verwerfen
            </button>
          </div>
          <Feedback error={error} />
      </div>
    </li>
  );
}
