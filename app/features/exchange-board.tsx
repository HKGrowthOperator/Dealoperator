"use client";
import { useState } from "react";
import {
  MessageCircle,
  Plus,
  Send,
  Search,
  BookOpen,
  Archive,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { AppData } from "../data";
import { Choice, Initials, Time, ConfirmAction, type Mutate } from "./shared";
export default function ExchangeBoard({
  data,
  mutate,
  demo,
  saving,
  onProfile,
}: {
  data: AppData;
  mutate: Mutate;
  demo: boolean;
  saving: boolean;
  onProfile: () => void;
}) {
  const [filter, setFilter] = useState("Alle");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    body: "",
    category: "Learning",
  });
  const [reply, setReply] = useState("");
  const [archive, setArchive] = useState<string | null>(null);
  const post = data.posts.find((p) => p.id === selected && !p.archived);
  const rows = data.posts.filter(
    (p) =>
      !p.archived &&
      (filter === "Alle" || filter === p.category) &&
      `${p.title} ${p.body} ${p.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="exchange-board">
      <div className="workflow-heading">
        <div>
          <span className="eyebrow">AUS DEM CALL-ALLTAG</span>
          <h2>Learnings, Fragen & ehrliches Feedback.</h2>
          <p>
            Dein Gesprächseinstieg. Ein schwieriger Einwand. Ein kleiner
            Fortschritt. Bring es in den Austausch.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => (data.profile.name ? setWriting(true) : onProfile())}
        >
          <Plus size={18} />
          Beitrag teilen
        </button>
      </div>
      <div className="board-controls">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            {["Alle", "Learning", "Frage", "Feedback", "Mindset"].map((t) => (
              <TabsTrigger key={t} value={t}>
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="search-input">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Beiträge durchsuchen"
            placeholder="Beiträge durchsuchen …"
          />
        </div>
      </div>
      <div className="discussion-list">
        {rows.map((p) => (
          <article className="card discussion-card" key={p.id}>
            <div className="discussion-author">
              <Initials name={p.name} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  <Time value={p.created} />
                </small>
              </span>
              <span className="tag">{p.category}</span>
            </div>
            <button
              className="discussion-title"
              onClick={() => {
                setSelected(p.id);
                setReply("");
              }}
            >
              <h3>{p.title}</h3>
            </button>
            <p className="discussion-preview">{p.body}</p>
            <button
              className="text-link"
              onClick={() => {
                setSelected(p.id);
                setReply("");
              }}
            >
              <MessageCircle size={16} />
              {data.comments.filter((c) => c.post === p.id).length} Antworten ·
              Mitreden
            </button>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="card compact-empty">
          <BookOpen size={26} />
          <h3>
            {data.posts.length
              ? "Keine passenden Beiträge."
              : "Dein Learning könnte jemandem helfen."}
          </h3>
          <p>
            {data.posts.length
              ? "Ändere den Filter oder deinen Suchbegriff."
              : "Teile die erste Frage oder eine Erfahrung aus deinen heutigen Calls."}
          </p>
          <button
            className="btn secondary"
            onClick={() => (data.profile.name ? setWriting(true) : onProfile())}
          >
            Ersten Beitrag schreiben
          </button>
        </div>
      )}
      <Dialog open={writing} onOpenChange={setWriting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Was möchtest du mit den anderen teilen?</DialogTitle>
            <DialogDescription>
              {demo
                ? "Fiktive Vorschau – dein Beitrag wird nicht öffentlich veröffentlicht."
                : "Sichtbar für alle angemeldeten Nutzer. Bitte keine vertraulichen Kundeninformationen teilen."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await mutate("post", draft, (d) => ({
                ...d,
                posts: [
                  {
                    ...draft,
                    id: crypto.randomUUID(),
                    owner: d.viewerId,
                    name: d.profile.name,
                    created: new Date().toISOString(),
                  },
                  ...d.posts,
                ],
              }));
              if (ok) {
                setWriting(false);
                setDraft({ title: "", body: "", category: "Learning" });
                toast.success(
                  demo
                    ? "Beispielbeitrag ergänzt."
                    : "Dein Beitrag ist jetzt für alle Angemeldeten sichtbar.",
                );
              }
            }}
          >
            <label>
              Art des Beitrags
              <Choice
                label="Art des Beitrags"
                value={draft.category}
                options={["Learning", "Frage", "Feedback", "Mindset"]}
                onChange={(v) => setDraft({ ...draft, category: v })}
              />
            </label>
            <label>
              Überschrift
              <input
                required
                minLength={5}
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Was hilft anderen, dein Thema zu verstehen?"
              />
            </label>
            <label>
              Dein Beitrag
              <textarea
                required
                minLength={10}
                maxLength={4000}
                rows={7}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="Beschreibe die Situation und wobei dir Austausch helfen würde …"
              />
            </label>
            <button className="btn primary" disabled={saving}>
              <Send size={17} />
              Beitrag teilen
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!post} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="article-dialog">
          <DialogHeader>
            <DialogTitle>{post?.title}</DialogTitle>
            <DialogDescription>
              {post?.name} · {post?.category} ·{" "}
              {demo ? "Beispielbeitrag" : "Beitrag im Austausch"}
            </DialogDescription>
          </DialogHeader>
          {post && (
            <>
              <p className="post-body">{post.body}</p>
              {post.owner === data.viewerId && (
                <button
                  className="text-button"
                  onClick={() => setArchive(post.id)}
                >
                  <Archive size={15} />
                  Eigenen Beitrag zurückziehen
                </button>
              )}
              <div className="thread-replies">
                <h3>
                  {data.comments.filter((c) => c.post === post.id).length}{" "}
                  Antworten
                </h3>
                {data.comments
                  .filter((c) => c.post === post.id)
                  .map((c) => (
                    <article key={c.id}>
                      <Initials name={c.name} />
                      <div>
                        <strong>
                          {c.name}{" "}
                          <small>
                            <Time value={c.created} />
                          </small>
                        </strong>
                        <p>{c.body}</p>
                      </div>
                    </article>
                  ))}
              </div>
              <form
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const body = reply.trim();
                  if (
                    await mutate("comment", { post: post.id, body }, (d) => ({
                      ...d,
                      comments: [
                        ...d.comments,
                        {
                          id: crypto.randomUUID(),
                          post: post.id,
                          owner: d.viewerId,
                          name: d.profile.name,
                          body,
                          created: new Date().toISOString(),
                        },
                      ],
                    }))
                  ) {
                    setReply("");
                    toast.success("Deine Antwort ist gespeichert.");
                  }
                }}
              >
                <label>
                  Deine Antwort
                  <textarea
                    rows={3}
                    required
                    minLength={2}
                    maxLength={2000}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Teile eine hilfreiche Frage oder Erfahrung …"
                  />
                </label>
                <button
                  className="btn primary"
                  disabled={saving || reply.trim().length < 2}
                >
                  <Send size={16} />
                  Antworten
                </button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={!!archive}
        onClose={() => setArchive(null)}
        title="Beitrag zurückziehen?"
        text="Der Beitrag wird aus dem Austausch genommen. Er bleibt im Datenbestand erhalten."
        busy={saving}
        onConfirm={async () => {
          if (
            await mutate("archivePost", archive, (d) => ({
              ...d,
              posts: d.posts.map((p) =>
                p.id === archive ? { ...p, archived: true } : p,
              ),
            }))
          ) {
            setArchive(null);
            setSelected(null);
            toast.success("Beitrag zurückgezogen.");
          }
        }}
      />
    </section>
  );
}
