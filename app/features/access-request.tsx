"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { call } from "./flow-parts";
export default function AccessRequest({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [fullName, setName] = useState(name),
    [phone, setPhone] = useState(""),
    [hint, setHint] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="auth-card card flow">
      <h1>Zugang anfragen</h1>
      <p>{email}</p>
      <form
        className="flow-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await call("/api/onboarding", {
              action: "access",
              value: { fullName, phone, hint },
            });
            router.push("/status");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          Vor- und Nachname
          <input
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Telefon
          <input
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label>
          Was möchtest du machen?
          <textarea
            maxLength={300}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          Zugang anfragen
        </button>
        <Link href="/profil-uebernehmen">Vorhandenes Profil auswählen</Link>
      </form>
    </section>
  );
}
