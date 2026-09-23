"use client";
import { useState } from "react";
import { Bell, Headphones, Mail, Smartphone } from "lucide-react";
import {
  Badge,
  DELIVERY_TONE,
  Feedback,
  adminPost,
  formatDateTime,
  type DiscordPart,
  type DiscordStatus,
  type NotificationStatus,
  type Tone,
} from "./admin-shared";

const KIND_LABEL: Record<string, string> = {
  "team:new": "Team: neue Registrierung",
  "team:claim": "Team: Profilübernahme prüfbereit",
  "team:answer": "Team: Antwort auf Rückfrage",
  "reminder:evening": "Abenderinnerung",
  "reminder:streak": "Serien-Warnung",
  test: "Testnachricht",
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Übergeben", tone: "ok" },
  skipped: { label: "Übersprungen", tone: "muted" },
  pending: { label: "Wartet", tone: "neutral" },
  sending: { label: "Wird gesendet", tone: "neutral" },
  failed: { label: "Fehlgeschlagen", tone: "danger" },
};
const KEY_SOURCE: Record<string, string> = {
  env: "Aus den Umgebungsvariablen (VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY).",
  database:
    "Vom Server erzeugt und in der Datenbank gespeichert. Bleibt gleich, solange der Eintrag besteht.",
  "noch nicht erzeugt":
    "Noch nicht erzeugt. Das Schlüsselpaar entsteht, sobald ein angemeldetes Konto die Push-Einrichtung zum ersten Mal öffnet.",
};

/**
 * Stand der Benachrichtigungen. Zeigt nur, was der Server meldet; fehlende
 * Konfiguration wird konkret benannt. „Übergeben“ heißt: an den Push-Dienst
 * bzw. an Resend übergeben, nicht „gelesen“.
 */
export function NotificationsPanel({
  status,
}: {
  status: NotificationStatus;
}) {
  const counts = status.counts || {};
  const recent = status.recent || [];
  const issues = status.email?.issues || [];
  return (
    <section className="adm-card" aria-labelledby="adm-notify-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Bell size={19} />
        </span>
        <div>
          <h2 id="adm-notify-title">Benachrichtigungen</h2>
          <p>
            Geräte-Pushs und E-Mail-Absicherung für Team-Meldungen. Team-Pushs
            kommen nur auf Geräten an, die du mit deinem Konto für Push
            eingerichtet hast und bei denen Team-Meldungen eingeschaltet sind.
          </p>
        </div>
      </div>
      <div className="adm-status-grid">
        <div className="adm-status">
          <span className="adm-status-title">
            <Smartphone size={16} /> Push
          </span>
          <Badge tone={status.push?.keys === "noch nicht erzeugt" ? "warn" : "neutral"}>
            Schlüssel:{" "}
            {status.push?.keys === "env"
              ? "Umgebung"
              : status.push?.keys === "database"
                ? "Datenbank"
                : "noch nicht erzeugt"}
          </Badge>
          <p>{KEY_SOURCE[status.push?.keys] ?? status.push?.keys}</p>
          <p>
            <strong className="adm-number">
              {(status.push?.devices ?? 0).toLocaleString("de-DE")}
            </strong>{" "}
            {status.push?.devices === 1
              ? "aktives Gerät (alle Konten)"
              : "aktive Geräte (alle Konten)"}
          </p>
          {(status.push?.needsReconsent ?? 0) > 0 && (
            <p className="adm-feedback" data-tone="warn">
              <strong className="adm-number">
                {(status.push?.needsReconsent ?? 0).toLocaleString("de-DE")}
              </strong>{" "}
              {status.push?.needsReconsent === 1
                ? "Gerät hat"
                : "Geräte haben"}{" "}
              einem früheren Server-Schlüssel zugestimmt und bekommen erst
              wieder Pushs, wenn die Einrichtung auf dem Gerät erneut bestätigt
              wird.
            </p>
          )}
        </div>
        <div className="adm-status">
          <span className="adm-status-title">
            <Mail size={16} /> E-Mail-Absicherung
          </span>
          {issues.length ? (
            <>
              <Badge tone="warn">Nicht eingerichtet</Badge>
              <ul className="adm-reasons">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <p className="adm-hint">
                Die Anmelde-Mails laufen unabhängig davon über den bestehenden
                Versand.
              </p>
            </>
          ) : (
            <>
              <Badge tone="neutral">Werte hinterlegt</Badge>
              <p>
                RESEND_API_KEY und NOTIFY_FROM sind gesetzt. Ob der Versand
                klappt, zeigen die letzten Meldungen unten.
              </p>
            </>
          )}
        </div>
      </div>
      <div className="adm-counts" aria-label="Letzte 14 Tage">
        <span className="adm-counts-title">Letzte 14 Tage</span>
        {(
          [
            ["sent", "übergeben"],
            ["waitingConfig", "warten auf E-Mail-Einrichtung"],
            ["waitingDevice", "warten auf ein Gerät mit Push"],
            ["open", "in der Warteschlange"],
            ["expired", "abgelaufen"],
            ["skipped", "nicht gesendet (z. B. ausgeschaltet oder kein Gerät)"],
            ["failed", "fehlgeschlagen"],
          ] as const
        ).map(([key, label]) => (
          <span key={key} data-tone={key === "failed" && counts[key] ? "danger" : undefined}>
            <strong className="adm-number">
              {(counts[key] ?? 0).toLocaleString("de-DE")}
            </strong>{" "}
            {label}
          </span>
        ))}
      </div>
      <h3 className="adm-subhead">Letzte Meldungen</h3>
      {recent.length ? (
        <ul className="adm-list adm-compact">
          {recent.map((n, index) => {
            const s = n.state
              ? { label: n.label, tone: DELIVERY_TONE[n.state] }
              : (STATUS[n.status] ?? { label: n.status, tone: "neutral" as Tone });
            return (
              <li className="adm-item" key={`${n.createdAt}-${index}`}>
                <div className="adm-item-head">
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <Badge tone="muted">
                    {n.channel === "email" ? "E-Mail" : n.channel === "push" ? "Push" : n.channel}
                  </Badge>
                  <span className="adm-meta">
                    {formatDateTime(n.createdAt)}
                    {n.sentAt ? ` · übergeben ${formatDateTime(n.sentAt)}` : ""}
                  </span>
                </div>
                <h3>{KIND_LABEL[n.kind] ?? n.kind}</h3>
                {n.detail && <p className="adm-hint">{n.detail}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-empty">Noch keine Meldungen verschickt oder vorgemerkt.</p>
      )}
    </section>
  );
}

const PARTS: { id: DiscordPart; title: string; text: string }[] = [
  {
    id: "link",
    title: "Kontoverknüpfung",
    text: "Mitglieder verbinden ihr Discord-Konto mit ihrem Deal-Operator-Konto (OAuth2, nur „identify“). Weiterleitung: /api/discord/callback an eurer Domain (APP_URL).",
  },
  {
    id: "posts",
    title: "Reflexionen als Beiträge",
    text: "Freigegebene, vollständige Reflexionen erscheinen im Reflexions-Channel; Korrekturen aktualisieren den Beitrag.",
  },
  {
    id: "interactions",
    title: "Interaktionen aus Discord",
    text: "Befehle und Knöpfe in Discord. Interactions-Endpunkt: /api/discord/interactions an eurer Domain.",
  },
  {
    id: "inventory",
    title: "Rollen und Channels lesen",
    text: "Liest vorhandene Rollen und Channels, damit ihr sie zuordnen könnt. Nur lesend.",
  },
];
const CHANNEL_TYPE: Record<number, string> = {
  0: "Text",
  2: "Sprache",
  4: "Kategorie",
  5: "Ankündigungen",
  13: "Bühne",
  15: "Forum",
  16: "Medien",
};
type Inventory =
  | { configured: false; missing: string[] }
  | {
      configured: true;
      roles: { id: string; name: string; position: number }[];
      channels: {
        id: string;
        name: string;
        type: number;
        parentId: string | null;
      }[];
    };

/**
 * Discord-Diagnose. „Werte hinterlegt“ heißt nur, dass die Umgebungsvariablen
 * gesetzt sind; es ist keine Bestätigung, dass die Anbindung funktioniert.
 */
export function DiscordPanel({ status }: { status: DiscordStatus }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inventoryMissing = status.missing?.inventory ?? [];
  const allMissing = [
    ...new Set(PARTS.flatMap((p) => status.missing?.[p.id] ?? [])),
  ];
  async function readInventory() {
    setBusy(true);
    setError("");
    try {
      setInventory(await adminPost<Inventory>("discordInventory"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const categories =
    inventory?.configured === true
      ? inventory.channels.filter((c) => c.type === 4)
      : [];
  const groups =
    inventory?.configured === true
      ? [
          {
            id: "none",
            name: "Ohne Kategorie",
            channels: inventory.channels.filter(
              (c) => c.type !== 4 && !c.parentId,
            ),
          },
          ...categories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            channels: inventory.channels.filter((c) => c.parentId === cat.id),
          })),
        ].filter((g) => g.channels.length)
      : [];
  return (
    <section className="adm-card" aria-labelledby="adm-discord-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Headphones size={19} />
        </span>
        <div>
          <h2 id="adm-discord-title">Discord</h2>
          <p>
            Stand der Anbindung, wie ihn der Server meldet. Website,
            Tagesabschluss und Push funktionieren unabhängig davon. Hinterlegte
            Werte sind noch keine Bestätigung, dass die Anbindung läuft.
          </p>
        </div>
      </div>
      {allMissing.length > 0 && (
        <div className="adm-feedback" data-tone="warn">
          Noch nicht eingerichtet. Fehlende Umgebungsvariablen insgesamt:{" "}
          {allMissing.map((name, i) => (
            <span key={name}>
              {i > 0 ? ", " : ""}
              <code>{name}</code>
            </span>
          ))}
          .
        </div>
      )}
      <ul className="adm-list adm-parts">
        {PARTS.map((part) => {
          const missing = status.missing?.[part.id] ?? [];
          return (
            <li key={part.id} className="adm-item">
              <div className="adm-item-head">
                <Badge tone={missing.length ? "warn" : "neutral"}>
                  {missing.length ? "Fehlt" : "Werte hinterlegt"}
                </Badge>
              </div>
              <h3>{part.title}</h3>
              <p className="adm-hint">{part.text}</p>
              {missing.length > 0 && (
                <p className="adm-missing">
                  Fehlt:{" "}
                  {missing.map((name, i) => (
                    <span key={name}>
                      {i > 0 ? ", " : ""}
                      <code>{name}</code>
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="adm-counts">
        <span>
          <strong className="adm-number">
            {(status.linkedAccounts ?? 0).toLocaleString("de-DE")}
          </strong>{" "}
          verknüpfte Konten
        </span>
        <span>
          <strong className="adm-number">
            {(status.postedReflections ?? 0).toLocaleString("de-DE")}
          </strong>{" "}
          Reflexionen mit Discord-Beitrag
        </span>
        <span>
          <strong className="adm-number">
            {(status.outbox?.pending ?? 0).toLocaleString("de-DE")}
          </strong>{" "}
          wartend in der Outbox
        </span>
        <span data-tone={status.outbox?.failed ? "danger" : undefined}>
          <strong className="adm-number">
            {(status.outbox?.failed ?? 0).toLocaleString("de-DE")}
          </strong>{" "}
          fehlgeschlagen
        </span>
      </div>
      <p className="adm-hint">
        Die Outbox sammelt Änderungen für Discord. Solange die Zugangsdaten
        fehlen, wird daraus nichts übertragen.
      </p>

      <h3 className="adm-subhead">Rollen und Channels</h3>
      <div className="adm-actions">
        <button
          className="btn secondary"
          disabled={busy || inventoryMissing.length > 0}
          onClick={readInventory}
        >
          {busy ? "Liest …" : "Rollen und Channels lesen"}
        </button>
        {inventoryMissing.length > 0 && (
          <span className="adm-hint">
            Erst möglich mit{" "}
            {inventoryMissing.map((name, i) => (
              <span key={name}>
                {i > 0 ? " und " : ""}
                <code>{name}</code>
              </span>
            ))}
            .
          </span>
        )}
      </div>
      <Feedback error={error} />
      {inventory?.configured === false && (
        <p className="adm-feedback" data-tone="warn">
          Nicht eingerichtet. Fehlt: {inventory.missing.join(", ")}.
        </p>
      )}
      {inventory?.configured === true && (
        <div className="adm-inventory">
          <div>
            <h4>Rollen ({inventory.roles.length})</h4>
            {inventory.roles.length ? (
              <ul>
                {inventory.roles.map((role) => (
                  <li key={role.id}>
                    <span>{role.name}</span>
                    <code>{role.id}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="adm-empty">Keine Rollen gefunden.</p>
            )}
          </div>
          <div>
            <h4>Channels ({inventory.channels.filter((c) => c.type !== 4).length})</h4>
            {groups.length ? (
              groups.map((group) => (
                <div key={group.id} className="adm-inventory-group">
                  <h5>{group.name}</h5>
                  <ul>
                    {group.channels.map((c) => (
                      <li key={c.id}>
                        <span>
                          {c.name}
                          <small>{CHANNEL_TYPE[c.type] ?? `Typ ${c.type}`}</small>
                        </span>
                        <code>{c.id}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="adm-empty">Keine Channels gefunden.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
