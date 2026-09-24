"use client";
import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { adminPost, formatDateTime } from "./admin-shared";

/**
 * Für Registrierungen mit noch unbestätigter E-Mail: das Team fordert die
 * Bestätigungsmail neu an. „Angefordert“, nicht „zugestellt“: Supabase meldet
 * keinen Empfang, und an eine schon bestätigte Adresse geht keine neue Mail.
 */
export default function ResendConfirmation({
  id,
  lastMailAt,
  onSent,
}: {
  id: string;
  /** Letzte belegte Übergabe einer Bestätigungsmail an Supabase. */
  lastMailAt?: string | null;
  onSent?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState("");
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    try {
      await adminPost("resendConfirmation", { id });
      setSentAt(new Date().toISOString());
      await onSent?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const last = sentAt || lastMailAt;
  return (
    <div className="do-resend">
      <button type="button" className="btn secondary" onClick={() => void send()} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
        Mail erneut senden
      </button>
      <p className="do-resend-meta">
        {last ? `Zuletzt angefordert: ${formatDateTime(last)}` : "Noch keine Bestätigungsmail belegt."}
      </p>
      <p className="do-resend-done" role="status">
        {sentAt
          ? "Neue Bestätigungsmail angefordert. Nach dem Klick auf den Link meldet sich die Person mit E-Mail und Passwort an. War die Adresse schon bestätigt, kommt keine Mail; dann geht die Anmeldung direkt."
          : ""}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
