"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleUserRound } from "lucide-react";
import type { Viewer } from "./operator-shell";

/**
 * Kontomenü im Kopf (nur angemeldet). Führt in den eigenen Bereich:
 * Mein Tag, Fortschritt, eigene Zahlen, Profil und Einstellungen.
 */
export default function AccountMenu({ viewer }: { viewer: Viewer }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  const close = () => setOpen(false);
  return (
    <div className="do-account" ref={root}>
      <button
        type="button"
        className="do-account-button"
        aria-label="Mein Bereich"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleUserRound size={24} aria-hidden="true" />
      </button>
      {open && (
        <div className="do-account-menu" id={`${id}-menu`}>
          <p className="do-account-title">
            Mein Bereich
            {viewer.role && (
              <span className="do-role-badge">
                {viewer.role === "admin" ? "Admin" : "Moderator"}
              </span>
            )}
          </p>
          <Link href="/tagesabschluss" onClick={close}>
            Mein Tag
          </Link>
          <Link href="/heute?modus=eigen" onClick={close}>
            Mein Fortschritt
          </Link>
          <Link href="/zahlen?modus=eigen" onClick={close}>
            Meine Zahlen
          </Link>
          <Link href="/profil?modus=eigen" onClick={close}>
            Profil und Einstellungen
          </Link>
          <Link href="/passwort" onClick={close}>
            {viewer.hasPassword ? "Passwort ändern" : "Passwort festlegen"}
          </Link>
          {viewer.team && (
            <Link href="/verwaltung" onClick={close}>
              Verwaltung
            </Link>
          )}
          <button type="button" onClick={() => void signOut()}>
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
