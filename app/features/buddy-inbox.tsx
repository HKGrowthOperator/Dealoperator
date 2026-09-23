"use client";
import { useState } from "react";
import { MessageCircle, Send, Users, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { AppData, Buddy } from "../data";
import { Initials, Time, type Mutate } from "./shared";
export default function BuddyInbox({
  data,
  mutate,
  demo,
  saving,
}: {
  data: AppData;
  mutate: Mutate;
  demo: boolean;
  saving: boolean;
}) {
  const [filter, setFilter] = useState("Alle");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const buddy = data.buddies.find((b) => b.id === selected);
  const peer = (b: Buddy) =>
    b.incoming
      ? b.name
      : b.peerName ||
        data.members.find((m) => m.id === b.to)?.name ||
        "Call-Partner";
  const incoming = data.buddies.filter(
    (b) => b.incoming && b.status === "pending",
  ).length;
  async function reply(b: Buddy, status: string) {
    const ok = await mutate("buddyReply", { id: b.id, status }, (d) => ({
      ...d,
      buddies: d.buddies.map((x) => (x.id === b.id ? { ...x, status } : x)),
    }));
    if (ok)
      toast.success(
        status === "accepted"
          ? "Ihr seid verbunden. Stimmt ab, wie ihr euch unterstützen wollt."
          : "Anfrage abgelehnt.",
      );
  }
  return (
    <section className="card workflow-section">
      <div className="workflow-heading">
        <div>
          <span className="eyebrow">DEINE VERBINDUNGEN</span>
          <h2>
            Call-Partner & Nachrichten{" "}
            {incoming > 0 && (
              <span className="count-badge">{incoming} neu</span>
            )}
          </h2>
          <p>
            Anfragen beantworten und abstimmen, wann ihr übt oder euch Feedback gebt.
          </p>
        </div>
        <MessageCircle size={25} />
      </div>
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="Alle">Alle</TabsTrigger>
          <TabsTrigger value="Buddys">Verbunden</TabsTrigger>
          <TabsTrigger value="Anfragen">Offene Anfragen</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="inbox-list">
        {data.buddies
          .filter(
            (b) =>
              filter === "Alle" ||
              (filter === "Buddys"
                ? b.status === "accepted"
                : b.status === "pending"),
          )
          .map((b) => (
            <article key={b.id} className="inbox-row">
              <Initials name={peer(b)} />
              <div>
                <h3>{peer(b)}</h3>
                <p>{b.message}</p>
                <span className={`status-label status-${b.status}`}>
                  {b.status === "accepted"
                    ? "Verbunden"
                    : b.status === "declined"
                      ? "Abgelehnt"
                      : b.status === "cancelled"
                        ? "Zurückgenommen"
                        : b.incoming
                          ? "Anfrage an dich"
                          : "Antwort ausstehend"}
                </span>
              </div>
              <div className="inbox-actions">
                {b.status === "pending" && b.incoming ? (
                  <>
                    <button
                      className="btn primary"
                      disabled={saving}
                      onClick={() => reply(b, "accepted")}
                    >
                      <Check size={16} />
                      Annehmen
                    </button>
                    <button
                      className="icon-button"
                      disabled={saving}
                      onClick={() => reply(b, "declined")}
                      aria-label={`Anfrage von ${peer(b)} ablehnen`}
                    >
                      <X size={18} />
                    </button>
                  </>
                ) : b.status === "pending" ? (
                  <button
                    className="text-button"
                    disabled={saving}
                    onClick={async () => {
                      if (
                        await mutate("buddyCancel", b.id, (d) => ({
                          ...d,
                          buddies: d.buddies.map((x) =>
                            x.id === b.id ? { ...x, status: "cancelled" } : x,
                          ),
                        }))
                      )
                        toast.success("Anfrage zurückgenommen.");
                    }}
                  >
                    Zurücknehmen
                  </button>
                ) : b.status === "accepted" ? (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setSelected(b.id);
                      setMessage("");
                    }}
                  >
                    Gespräch öffnen
                  </button>
                ) : null}
              </div>
            </article>
          ))}
      </div>
      {!data.buddies.filter(
        (b) =>
          filter === "Alle" ||
          (filter === "Buddys"
            ? b.status === "accepted"
            : b.status === "pending"),
      ).length && (
        <div className="compact-empty">
          <Users size={25} />
          <h3>
            {filter === "Buddys"
              ? "Weitere Call-Partner findest du im Bereich Call-Partner."
              : "Hier bist du auf dem aktuellen Stand."}
          </h3>
          <p>
            Neue Anfragen und eure Verbindungen findest du an dieser Stelle.
          </p>
        </div>
      )}
      <Dialog open={!!buddy} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="conversation-dialog">
          <DialogHeader>
            <DialogTitle>Dein Gespräch mit {buddy && peer(buddy)}</DialogTitle>
            <DialogDescription>
              {demo
                ? "Vorschau: Nachrichten werden nur innerhalb dieser Demo angezeigt."
                : "Nur für euch beide sichtbar. Neue Nachrichten erscheinen automatisch, solange die Website geöffnet ist."}
            </DialogDescription>
          </DialogHeader>
          <div className="conversation-messages">
            <div className="conversation-start">
              <MessageCircle size={23} />
              <p>
                Ihr seid verbunden. Klärt Zeit, Kanal und Fokus, zum Beispiel für
                ein Roleplay, Feedback oder einen zusätzlichen Block.
              </p>
            </div>
            {data.messages
              .filter((m) => m.thread === selected)
              .map((m) => (
                <div
                  key={m.id}
                  className={`chat-bubble ${m.sender === data.viewerId ? "mine" : ""}`}
                >
                  <small>
                    {m.sender === data.viewerId ? "Du" : m.name} ·{" "}
                    <Time value={m.created} />
                  </small>
                  <p>{m.body}</p>
                </div>
              ))}
          </div>
          <form
            className="message-compose"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = message.trim();
              if (!buddy || !body) return;
              const ok = await mutate(
                "buddyMessage",
                { thread: buddy.id, body },
                (d) => ({
                  ...d,
                  messages: [
                    ...d.messages,
                    {
                      id: crypto.randomUUID(),
                      thread: buddy.id,
                      sender: d.viewerId,
                      name: d.profile.name,
                      body,
                      created: new Date().toISOString(),
                    },
                  ],
                }),
              );
              if (ok) {
                setMessage("");
                toast.success(
                  demo
                    ? "Nachricht in der Demo ergänzt."
                    : "Nachricht gespeichert.",
                );
              }
            }}
          >
            <label className="sr-only" htmlFor="buddy-message">
              Nachricht an deinen Buddy
            </label>
            <textarea
              id="buddy-message"
              required
              maxLength={2000}
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Wann passt es dir für ein Roleplay oder kurzes Feedback?"
            />
            <button
              className="btn primary"
              disabled={saving || !message.trim()}
            >
              <Send size={18} />
              <span>Senden</span>
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
