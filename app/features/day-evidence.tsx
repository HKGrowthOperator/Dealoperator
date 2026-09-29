"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";

type Evidence = { enabled: false } | { enabled: true; talkMinutes: number | null; hasImage: boolean; imageAt: string | null };

/** Größte Kante nach dem Verkleinern; reicht, um Zahlen im CRM zu lesen. */
const MAX_EDGE = 1600;
const MAX_BYTES = 1_400_000;

/**
 * Bild im Browser verkleinern und neu als JPEG speichern. Das entfernt auch
 * Metadaten wie Ort oder Gerät aus der Datei.
 */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (quality: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", quality),
    );
  let quality = 0.82;
  let blob = await toBlob(quality);
  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality -= 0.12;
    blob = await toBlob(quality);
  }
  if (blob.size > MAX_BYTES) throw new Error("zu groß");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function send(value: Record<string, unknown>) {
  const response = await fetch("/api/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Das hat gerade nicht geklappt. Bitte versuch es noch einmal.");
  return data as { talkMinutes: number | null; hasImage: boolean; imageAt: string | null };
}

const split = (minutes: number | null) =>
  minutes === null ? { h: "", m: "" } : { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) };

/**
 * Freiwillig im Tagesabschluss: Gesprächszeit laut CRM und ein Screenshot.
 * Wird sofort gespeichert, unabhängig vom Einreichen. Nur sichtbar, wenn die
 * Funktion freigeschaltet ist.
 */
export default function DayEvidence({ day }: { day: string }) {
  const uid = useId();
  const [state, setState] = useState<Evidence | null>(null);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState({ h: "", m: "" });
  const [busy, setBusy] = useState<"time" | "image" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const saved = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/evidence?tag=${day}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((data: Evidence) => {
        setState(data);
        setStatus(null);
        if (data.enabled) {
          saved.current = data.talkMinutes;
          setTime(split(data.talkMinutes));
          if (data.talkMinutes !== null || data.hasImage) setOpen(true);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [day]);

  if (!state?.enabled) return null;

  const minutes = () => {
    if (!time.h.trim() && !time.m.trim()) return null;
    const h = Number(time.h || 0);
    const m = Number(time.m || 0);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59 || h > 24) return NaN;
    return Math.min(1440, h * 60 + m);
  };

  async function saveTime() {
    const value = minutes();
    if (Number.isNaN(value)) {
      setStatus({ tone: "error", text: "Bitte Stunden und Minuten als ganze Zahlen eingeben (Minuten bis 59)." });
      return;
    }
    if (value === saved.current) return;
    setBusy("time");
    try {
      const data = await send({ day, talkMinutes: value });
      saved.current = data.talkMinutes;
      setState({ enabled: true, ...data });
      setStatus({ tone: "ok", text: value === null ? "Gesprächszeit entfernt." : "Gesprächszeit gespeichert." });
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function saveImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus({ tone: "error", text: "Bitte ein Bild wählen, zum Beispiel einen Screenshot." });
      return;
    }
    setBusy("image");
    setStatus(null);
    try {
      const image = await shrink(file);
      const data = await send({ day, image });
      setState({ enabled: true, ...data });
      setStatus({ tone: "ok", text: "Screenshot gespeichert. Nur du und das Team sehen ihn." });
    } catch (e) {
      const message = (e as Error).message;
      setStatus({
        tone: "error",
        text: message === "zu groß" || message === "blob" ? "Dieses Bild lässt sich nicht verkleinern. Bitte einen Ausschnitt wählen." : message,
      });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeImage() {
    setBusy("image");
    try {
      const data = await send({ day, removeImage: true });
      setState({ enabled: true, ...data });
      setStatus({ tone: "ok", text: "Screenshot entfernt." });
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const stopEnter = (e: React.KeyboardEvent) => {
    // Enter speichert hier die Gesprächszeit, nicht den ganzen Tagesabschluss.
    if (e.key === "Enter") {
      e.preventDefault();
      void saveTime();
    }
  };

  return (
    <div className="md-evidence-wrap">
      <button
        type="button"
        className="cm-toggle"
        aria-expanded={open}
        aria-controls={`${uid}-evidence`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Gesprächszeit und Screenshot ausblenden" : "Gesprächszeit und CRM-Screenshot (freiwillig)"}
      </button>
      <div id={`${uid}-evidence`} className="md-evidence" hidden={!open}>
        <div className="md-evidence-time" role="group" aria-labelledby={`${uid}-time`}>
          <p id={`${uid}-time`} className="cm-label">
            Gesprächszeit laut CRM
          </p>
          <div className="md-evidence-fields">
            <label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={time.h}
                aria-label="Stunden"
                onChange={(e) => setTime({ ...time, h: e.target.value.replace(/\D/g, "") })}
                onBlur={() => void saveTime()}
                onKeyDown={stopEnter}
              />
              <span>Std.</span>
            </label>
            <label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={time.m}
                aria-label="Minuten"
                onChange={(e) => setTime({ ...time, m: e.target.value.replace(/\D/g, "") })}
                onBlur={() => void saveTime()}
                onKeyDown={stopEnter}
              />
              <span>Min.</span>
            </label>
            {busy === "time" && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
          </div>
        </div>
        <div className="md-evidence-shot">
          <p className="cm-label">Screenshot mit Anwahlen und Gesprächszeit</p>
          {state.hasImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- privates Bild, kein Bild-Optimierer */}
              <img
                src={`/api/evidence?tag=${day}&bild=1&v=${encodeURIComponent(state.imageAt ?? "")}`}
                alt="Dein CRM-Screenshot für diesen Tag"
              />
              <div className="md-evidence-actions">
                <button type="button" className="do-link" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={16} aria-hidden="true" />
                  Anderes Bild wählen
                </button>
                <button type="button" className="do-link" disabled={!!busy} onClick={() => void removeImage()}>
                  <Trash2 size={16} aria-hidden="true" />
                  Entfernen
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="do-button do-button-secondary" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === "image" ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <ImagePlus size={17} aria-hidden="true" />}
              Screenshot hochladen
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void saveImage(e.target.files?.[0])}
          />
          <p className="md-evidence-note">
            Nur du und das Team sehen ihn. Namen und Nummern deiner Kontakte bitte vorher abdecken.
          </p>
        </div>
        {status && (
          <p className={status.tone === "error" ? "cm-field-error" : "md-evidence-status"} role={status.tone === "error" ? "alert" : "status"}>
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}
