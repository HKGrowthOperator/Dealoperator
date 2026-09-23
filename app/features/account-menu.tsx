"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleUserRound } from "lucide-react";

type Me = { signedIn: boolean; hasPassword: boolean } | null;

/**
 * Kontosymbol im Kopf. Abgemeldet: Anmelden oder Registrieren. Angemeldet:
 * eigener Bereich, Passwort, Abmelden. Der Stand kommt vom Server
 * (/api/auth), die Seite selbst bleibt dadurch für alle gleich.
 */
export default function AccountMenu() {
  const id = useId();
  const [me, setMe] = useState<Me>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setMe({ signedIn: !!data.signedIn, hasPassword: !!data.hasPassword });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function signOut() {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signout" }),
    });
    // Voller Seitenwechsel verwirft alle privaten Daten im Speicher.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.ok) window.location.href = "/";
  }

  return (
    <div className="op-account" ref={root}>
      <button
        type="button"
        className="op-account-button"
        aria-label={me?.signedIn ? "Dein Konto" : "Anmelden oder registrieren"}
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleUserRound size={24} aria-hidden="true" />
        {me?.signedIn && <span className="op-account-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="op-account-menu" id={`${id}-menu`}>
          {me?.signedIn ? (
            <>
              <Link href="/heute?modus=eigen" onClick={() => setOpen(false)}>
                Mein Bereich
              </Link>
              <Link href="/passwort" onClick={() => setOpen(false)}>
                {me.hasPassword ? "Passwort ändern" : "Passwort festlegen"}
              </Link>
              <button type="button" onClick={() => void signOut()}>
                Abmelden
              </button>
            </>
          ) : (
            <>
              <Link href="/anmelden" onClick={() => setOpen(false)}>
                Anmelden
              </Link>
              <Link href="/starten" onClick={() => setOpen(false)}>
                Registrieren
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
