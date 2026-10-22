"use client";
import { useState } from "react";
import Link from "next/link";
import { Camera, Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import type { MemberProfile } from "@/lib/members";
import { AVAILABILITY } from "@/lib/members";
import { call } from "./flow-parts";
import { MemberPhoto } from "./member-directory";

async function photo(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 10_000_000
  )
    throw Error("Bitte ein JPG-, PNG- oder WebP-Foto bis 10 MB auswählen.");
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw Error("Das Foto konnte nicht verarbeitet werden.");
  }
  const side = Math.min(bmp.width, bmp.height);
  ctx.drawImage(
    bmp,
    (bmp.width - side) / 2,
    (bmp.height - side) / 2,
    side,
    side,
    0,
    0,
    512,
    512,
  );
  bmp.close();
  for (const quality of [0.82, 0.65, 0.45]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length < 160000) return data;
  }
  throw Error("Bitte ein kleineres Foto auswählen.");
}
export default function MemberEditor({
  initial,
  name,
  avatarUrl,
}: {
  initial: MemberProfile;
  name: string;
  avatarUrl: string;
}) {
  const [v, setV] = useState(initial),
    [avatar, setAvatar] = useState(avatarUrl),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState(false),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState(false);
  const patch = <K extends keyof MemberProfile>(
    key: K,
    value: MemberProfile[K],
  ) => {
    setV((old) => ({ ...old, [key]: value }));
    setSaved(false);
  };
  async function uploadPhoto(file: File) {
    setUpload(true);
    setMessage("");
    try {
      const data = await photo(file);
      await call("/api/members", { action: "avatar", value: { data } });
      setAvatar(data);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setUpload(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setSaved(false);
    try {
      await call("/api/members", { action: "save", value: v });
      setSaved(true);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="inhalt" className="mn-page mn-editor">
      <Link className="mn-back" href="/mitglieder">
        Alle Mitglieder
      </Link>
      <header className="mn-heading">
        <div>
          <p className="mn-eyebrow">Dein Profil</p>
          <h1>Zeig, was du machst.</h1>
          <p>Und wobei ihr euch ergänzen könnt.</p>
        </div>
        <Link className="btn secondary" href="/profil?modus=eigen">
          Konto & Erinnerungen
        </Link>
      </header>
      <div className="mn-photo-edit">
        <MemberPhoto member={{ name, avatarUrl: avatar }} size="large" />
        <div>
          <strong>{name}</strong>
          <label className="btn secondary mn-photo-label">
            <Camera size={18} />
            {upload ? "Foto wird gespeichert …" : "Profilfoto auswählen"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={upload}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPhoto(file);
                e.target.value = "";
              }}
            />
          </label>
          {avatar && (
            <button
              className="mn-back"
              disabled={upload}
              onClick={async () => {
                setUpload(true);
                try {
                  await call("/api/members", {
                    action: "avatar",
                    value: { data: "" },
                  });
                  setAvatar("");
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setUpload(false);
                }
              }}
            >
              Foto entfernen
            </button>
          )}
        </div>
      </div>
      <form onSubmit={submit} className="mn-edit-form">
        <section className="mn-section">
          <h2>Auf einen Blick</h2>
          <label>
            Was machst du?
            <input
              required
              maxLength={120}
              value={v.headline}
              onChange={(e) => patch("headline", e.target.value)}
              placeholder="Recruiting für Handwerksbetriebe"
            />
          </label>
          <div className="mn-field-row">
            <label>
              Unternehmen
              <input
                maxLength={120}
                value={v.company}
                onChange={(e) => patch("company", e.target.value)}
              />
            </label>
            <label>
              Standort
              <input
                maxLength={80}
                value={v.location}
                onChange={(e) => patch("location", e.target.value)}
              />
            </label>
          </div>
          <label>
            Deine Angebote
            <input
              value={v.services.join(", ")}
              onChange={(e) =>
                patch(
                  "services",
                  e.target.value.split(",").map((s) => s.trimStart()),
                )
              }
              onBlur={() =>
                patch(
                  "services",
                  v.services.map((s) => s.trim()).filter(Boolean),
                )
              }
              placeholder="Recruiting, Social Ads, Employer Branding"
            />
          </label>
          <label>
            Branchen
            <input
              value={v.industries.join(", ")}
              onChange={(e) =>
                patch(
                  "industries",
                  e.target.value.split(",").map((s) => s.trimStart()),
                )
              }
              onBlur={() =>
                patch(
                  "industries",
                  v.industries.map((s) => s.trim()).filter(Boolean),
                )
              }
              placeholder="Handwerk, Bau, Gebäudetechnik"
            />
          </label>
          <label>
            Über dich und deine Arbeit
            <textarea
              rows={4}
              maxLength={1000}
              value={v.about}
              onChange={(e) => patch("about", e.target.value)}
            />
          </label>
        </section>
        <section className="mn-section">
          <h2>Was gerade bei dir ansteht</h2>
          <label>
            Aktuelle Projekte
            <textarea
              rows={3}
              maxLength={1400}
              value={v.projects}
              onChange={(e) => patch("projects", e.target.value)}
              placeholder="Woran arbeitest du gerade?"
            />
          </label>
          <label>
            Dabei suche ich Unterstützung
            <textarea
              rows={3}
              maxLength={1000}
              value={v.lookingFor}
              onChange={(e) => patch("lookingFor", e.target.value)}
              placeholder="Zum Beispiel: Partner für die Umsetzung von Recruiting-Landingpages"
            />
          </label>
          <label>
            Zusammenarbeit
            <select
              value={v.availability}
              onChange={(e) =>
                patch(
                  "availability",
                  e.target.value as MemberProfile["availability"],
                )
              }
            >
              {Object.entries(AVAILABILITY).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </section>
        <section className="mn-section">
          <h2>Kontakt im Mitgliederprofil</h2>
          <div className="mn-field-row">
            <label>
              Telefon
              <input
                type="tel"
                autoComplete="tel"
                maxLength={40}
                value={v.contactPhone}
                onChange={(e) => patch("contactPhone", e.target.value)}
                placeholder="+49 …"
              />
            </label>
            <label>
              E-Mail
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                value={v.contactEmail}
                onChange={(e) => patch("contactEmail", e.target.value)}
              />
            </label>
          </div>
          <label>
            Website
            <input
              type="url"
              maxLength={400}
              value={v.website}
              onChange={(e) => patch("website", e.target.value)}
              placeholder="https://…"
            />
          </label>
        </section>
        <section className="mn-section">
          <h2>Referenzen & Einblicke</h2>
          {v.references.map((r, i) => (
            <div className="mn-reference-edit" key={i}>
              <label>
                Projekt oder Referenz
                <input
                  required
                  maxLength={100}
                  value={r.title}
                  onChange={(e) =>
                    patch(
                      "references",
                      v.references.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Ergebnis oder Einblick
                <textarea
                  rows={2}
                  maxLength={500}
                  value={r.description}
                  onChange={(e) =>
                    patch(
                      "references",
                      v.references.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Link
                <input
                  type="url"
                  maxLength={400}
                  value={r.url}
                  onChange={(e) =>
                    patch(
                      "references",
                      v.references.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="https://…"
                />
              </label>
              <button
                className="mn-back"
                type="button"
                onClick={() =>
                  patch(
                    "references",
                    v.references.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={16} />
                Referenz entfernen
              </button>
            </div>
          ))}
          {v.references.length < 6 && (
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                patch("references", [
                  ...v.references,
                  { title: "", description: "", url: "" },
                ])
              }
            >
              <Plus size={17} />
              Referenz hinzufügen
            </button>
          )}
        </section>
        <footer className="mn-save">
          <label className="mn-publish">
            <input
              type="checkbox"
              checked={v.listed}
              onChange={(e) => patch("listed", e.target.checked)}
            />
            Profil für Mitglieder anzeigen
          </label>
          {message && (
            <p role="alert" className="form-error">
              {message}
            </p>
          )}
          {saved && (
            <p role="status" className="mn-success">
              <Check size={17} />
              Profil gespeichert.
            </p>
          )}
          <button className="btn primary" disabled={busy || upload}>
            {busy && <LoaderCircle className="spin" size={18} />}Änderungen
            speichern
          </button>
        </footer>
      </form>
    </main>
  );
}
