"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserRound, LoaderCircle } from "lucide-react";

export default function MemberOnboarding({
  next,
  candidates,
}: {
  next: string;
  candidates: { id: string; name: string; company: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState({
    name: "",
    company: "",
    role: "",
    publicConsent: false,
    confirmNew: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "onboard", value }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      router.replace(next);
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="auth-card card">
      <span className="icon-tile">
        <UserRound />
      </span>
      <h1>Willkommen in der Crew.</h1>
      <p>
        Deine E-Mail ist bestätigt. Verbinde jetzt deine bisherigen Zahlen oder
        richte dein Profil ein.
      </p>
      {candidates.length > 0 && (
        <div className="onboarding-candidates">
          <strong>Diese Profile passen zu deiner E-Mail</strong>
          {candidates.map((p) => (
            <Link
              key={p.id}
              href={`/profil-uebernehmen?profil=${encodeURIComponent(p.id)}`}
            >
              <strong>{p.name}</strong>
              <small>
                {p.company || "Vorbereitetes Community-Profil"} · Bisherige
                Zahlen übernehmen
              </small>
            </Link>
          ))}
        </div>
      )}
      <Link className="text-link" href="/profil-uebernehmen">
        Ich habe einen persönlichen Übernahmecode
      </Link>
      <form className="form-stack onboarding-divider" onSubmit={submit}>
        <h2>
          {candidates.length
            ? "Oder ein neues Profil anlegen"
            : "Dein Profil einrichten"}
        </h2>
        <label>
          Dein Anzeigename
          <input
            autoComplete="nickname"
            required
            minLength={2}
            maxLength={60}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          Unternehmen (optional)
          <input
            autoComplete="organization"
            maxLength={120}
            value={value.company}
            onChange={(e) => setValue({ ...value, company: e.target.value })}
          />
        </label>
        <label>
          Deine Rolle (optional)
          <input
            autoComplete="organization-title"
            maxLength={80}
            placeholder="Zum Beispiel Setter oder Closer"
            value={value.role}
            onChange={(e) => setValue({ ...value, role: e.target.value })}
          />
        </label>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={value.publicConsent}
            onChange={(e) =>
              setValue({ ...value, publicConsent: e.target.checked })
            }
          />
          <span>
            Meine selbst gemeldeten Zahlen mit Anzeigename, Unternehmen und
            Rolle im öffentlichen Ranking zeigen. Meine E-Mail und Reflexionen
            bleiben privat.
          </span>
        </label>
        {candidates.length > 0 && (
          <label className="checkbox-line">
            <input
              type="checkbox"
              required
              checked={value.confirmNew}
              onChange={(e) =>
                setValue({ ...value, confirmNew: e.target.checked })
              }
            />
            <span>
              Ich möchte neu starten. Die vorhandenen Zahlen werden dabei nicht
              übernommen.
            </span>
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary full" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="spin" />
              Profil wird eingerichtet …
            </>
          ) : (
            "Mit meiner Crew starten"
          )}
        </button>
        <small>
          Deine Sichtbarkeit kannst du später in deinem Profil ändern.
        </small>
      </form>
    </section>
  );
}
