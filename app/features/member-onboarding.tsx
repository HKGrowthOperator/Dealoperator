"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserRound, LoaderCircle } from "lucide-react";

/**
 * Profileinrichtung nach bestätigter E-Mail für den Weg „Ich bin neu".
 * Eine Profilübernahme läuft nicht hierüber, sondern über die Teamfreigabe.
 */
export default function MemberOnboarding({
  next,
  presetName,
}: {
  next: string;
  presetName: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState({
    name: presetName,
    company: "",
    role: "",
    publicConsent: false,
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
      <h1>Willkommen bei Deal Operator.</h1>
      <p>
        Deine E-Mail ist bestätigt. Richte jetzt dein Profil ein und starte mit
        deinen eigenen Zahlen.
      </p>
      <p className="onboarding-signin">
        Deine Zahlen stehen schon im Ranking?{" "}
        <Link href="/profil-uebernehmen">Übernahme anfragen</Link>
      </p>
      <form className="form-stack" onSubmit={submit}>
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
          <small>
            So sehen dich die anderen, die mitcallen. Dein voller Name bleibt beim
            Team.
          </small>
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
            Rolle im öffentlichen Ranking zeigen. Meine E-Mail und
            Telefonnummer bleiben privat.
          </span>
        </label>
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
            "Mit meinen Zahlen starten"
          )}
        </button>
        <small>
          Deine Sichtbarkeit kannst du später in deinem Profil ändern.
        </small>
      </form>
    </section>
  );
}
