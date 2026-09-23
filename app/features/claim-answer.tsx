"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Send } from "lucide-react";

/** Antwort auf eine Rückfrage des Teams; danach geht die Anfrage zurück in die Prüfung. */
export default function ClaimAnswer() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", value: { message } }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <form className="flow-form" onSubmit={submit}>
      <div className="flow-field" data-invalid={error ? "" : undefined}>
        <label htmlFor="claim-answer">Deine Antwort an das Team</label>
        <textarea
          id="claim-answer"
          required
          minLength={3}
          maxLength={1000}
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "claim-answer-error" : undefined}
        />
        {error && (
          <p id="claim-answer-error" className="flow-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="btn primary full" disabled={busy}>
        {busy ? <LoaderCircle className="spin" /> : <Send size={18} />}
        Antwort senden
      </button>
    </form>
  );
}
