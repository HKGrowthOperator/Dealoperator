"use client";
import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import {
  berlinDate,
  countsSchema,
  emptyCounts,
  metricLabels,
  metrics,
} from "@/lib/kpis";
import type { RecordDay } from "../data";
import { toast } from "sonner";
export default function CheckinEditor({
  records,
  initialDate,
  demo,
  onSaved,
}: {
  records: RecordDay[];
  initialDate: string;
  demo: boolean;
  onSaved: (record: RecordDay) => void | Promise<void>;
}) {
  const init = (date: string) => {
    const r = records.find((r) => r.date === date);
    return {
      date,
      counts: r?.counts || {
        ...emptyCounts(),
        attempts: r?.attempts ?? null,
        legacyMeetings: r?.meetings ?? null,
      },
      reflection: {
        win: r?.win || "",
        next: r?.next || "",
        help: r?.help || "",
        energy: r?.energy ?? 7,
      },
      revision: r?.revision || 0,
    };
  };
  const [value, setValue] = useState(() => init(initialDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [request, setRequest] = useState<{ hash: string; key: string } | null>(
    null,
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      countsSchema.parse(value.counts);
      const hash = JSON.stringify(value);
      const key = request?.hash === hash ? request.key : crypto.randomUUID();
      setRequest({ hash, key });
      let revision = value.revision + 1;
      if (!demo) {
        const r = await fetch("/api/operator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "checkin",
            value: {
              date: value.date,
              counts: value.counts,
              reflection: value.reflection,
              expectedRevision: value.revision,
              idempotencyKey: key,
            },
          }),
        });
        const d = await r.json();
        if (!r.ok) {
          if (r.status === 409) setConflict(true);
          throw Error(d.error);
        }
        revision = d.revision;
      }
      const record: RecordDay = {
        date: value.date,
        attempts: value.counts.attempts,
        conversations: value.counts.decisionMakerConversations,
        meetings: value.counts.legacyMeetings,
        counts: value.counts,
        revision,
        ...value.reflection,
        shared: false,
      };
      await onSaved(record);
      setValue((v) => ({ ...v, revision }));
      setRequest(null);
      toast.success(
        demo
          ? "Beispiel-Check-in gespeichert. Nur in dieser Vorschau."
          : "Dein Check-in ist gespeichert.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="checkin-form">
      <p>
        Halte deinen vollständigen Tagesstand fest. Leere Felder bedeuten „nicht
        gemeldet“, eine 0 bedeutet „heute keine“. Mehrere Meldungen am selben
        Tag ersetzen den vorherigen Stand.
      </p>
      <label>
        Dein Call-Tag
        <input
          type="date"
          value={value.date}
          max={berlinDate()}
          required
          onChange={(e) => {
            if (e.target.value) {
              setValue(init(e.target.value));
              setRequest(null);
              setConflict(false);
              setError("");
            }
          }}
        />
      </label>
      <div className="checkin-fields">
        {metrics
          .filter(
            (k) =>
              k !== "legacyMeetings" || value.counts.legacyMeetings !== null,
          )
          .map((k) => (
            <label key={k}>
              {metricLabels[k]}
              <input
                aria-label={metricLabels[k]}
                type="number"
                min="0"
                max="100000"
                step="1"
                inputMode="numeric"
                value={value.counts[k] ?? ""}
                placeholder="Nicht gemeldet"
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    counts: {
                      ...v.counts,
                      [k]:
                        e.target.value === "" ? null : Number(e.target.value),
                    },
                  }))
                }
              />
            </label>
          ))}
      </div>
      <p>
        Termine können aus früheren Gesprächen stammen. „Closings vereinbart“
        zählt gebuchte Abschlussgespräche, „Deals gewonnen“ zählt gewonnene
        Aufträge.
      </p>
      <label>
        Was lief gut oder was hast du gelernt?
        <textarea
          rows={3}
          maxLength={1500}
          value={value.reflection.win}
          onChange={(e) =>
            setValue((v) => ({
              ...v,
              reflection: { ...v.reflection, win: e.target.value },
            }))
          }
          placeholder="Ein Einstieg, der funktioniert hat. Ein Einwand, den du besser verstanden hast …"
        />
      </label>
      <label>
        Dein nächster konkreter Schritt
        <textarea
          rows={2}
          maxLength={1500}
          required
          value={value.reflection.next}
          onChange={(e) =>
            setValue((v) => ({
              ...v,
              reflection: { ...v.reflection, next: e.target.value },
            }))
          }
          placeholder="Was probierst du beim nächsten Call?"
        />
      </label>
      <label>
        Wobei kann dich die Crew unterstützen?
        <input
          maxLength={1500}
          value={value.reflection.help}
          onChange={(e) =>
            setValue((v) => ({
              ...v,
              reflection: { ...v.reflection, help: e.target.value },
            }))
          }
          placeholder="Optional"
        />
      </label>
      <label>
        Deine Energie · {value.reflection.energy}/10
        <input
          aria-label="Deine Energie"
          type="range"
          min="1"
          max="10"
          value={value.reflection.energy}
          onChange={(e) =>
            setValue((v) => ({
              ...v,
              reflection: { ...v.reflection, energy: Number(e.target.value) },
            }))
          }
        />
      </label>
      <p>
        Deine Reflexion bleibt privat. Die Anzeige deiner Zahlen im öffentlichen
        Ranking stellst du separat in deinem Profil ein.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {conflict && (
        <button
          type="button"
          className="btn secondary"
          onClick={async () => {
            try {
              const r = await fetch("/api/operator", { cache: "no-store" });
              const d = await r.json();
              if (!r.ok) throw Error(d.error);
              const current = d.records.find(
                (r: { day: string }) => r.day === value.date,
              );
              if (current)
                setValue({
                  date: current.day,
                  counts: current.counts,
                  reflection: {
                    win: "",
                    next: "",
                    help: "",
                    energy: 7,
                    ...current.reflection,
                  },
                  revision: current.revision,
                });
              else
                setValue({
                  ...init(value.date),
                  counts: emptyCounts(),
                  revision: 0,
                });
              setConflict(false);
              setError("");
              setRequest(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <RefreshCw size={16} />
          Aktuellen Stand laden (ersetzt diesen Entwurf)
        </button>
      )}
      <button className="btn primary" disabled={busy || conflict}>
        {busy ? <RefreshCw className="spin" size={17} /> : <Check size={17} />}
        Check-in speichern
      </button>
    </form>
  );
}
