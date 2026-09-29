"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Copy, Inbox, KeyRound, LoaderCircle, Sparkles, X } from "lucide-react";
import { AdminError, adminPost, Feedback, type TeamAccess } from "./admin-shared";

type Created = {
  name: string;
  email: string;
  participant: string;
  created: boolean;
  passwordSet: boolean;
  /** Konto aus einem früheren, abgebrochenen Versuch: es gilt das Passwort von damals. */
  earlier: boolean;
  /** Neues Konto: Supabase hat seine Bestätigungsmail geschickt. */
  newAccount: boolean;
};

// Gut lesbare Wörter ohne Umlaute, damit das Passwort überall tippbar ist.
// 128 Wörter, zwei davon plus vier Ziffern: rund 27 Bit Zufall.
const WORDS = [
  "Anker", "Birke", "Delfin", "Falke", "Hafen", "Insel", "Kompass", "Leuchtturm",
  "Nordlicht", "Pilot", "Radar", "Segel", "Tiger", "Wolke", "Komet", "Gipfel",
  "Brise", "Fuchs", "Adler", "Welle", "Kaffee", "Sonne", "Rakete", "Fels",
  "Apfel", "Ballon", "Banane", "Blitz", "Blume", "Boot", "Brief", "Buch",
  "Burg", "Dach", "Drache", "Eiche", "Engel", "Erde", "Farbe", "Feder",
  "Fenster", "Feuer", "Fisch", "Flagge", "Fluss", "Frosch", "Garten", "Geige",
  "Glocke", "Gold", "Hammer", "Hase", "Held", "Himmel", "Hirsch", "Honig",
  "Igel", "Jacke", "Kakao", "Kamel", "Kanu", "Karte", "Katze", "Kerze",
  "Kiwi", "Koala", "Koffer", "Krone", "Kugel", "Lampe", "Laterne", "Leiter",
  "Luchs", "Mango", "Mantel", "Meer", "Melone", "Mond", "Motor", "Muschel",
  "Nebel", "Oase", "Ofen", "Orange", "Palme", "Panda", "Papier", "Pfeil",
  "Pferd", "Pinsel", "Planet", "Pokal", "Quelle", "Rabe", "Regen", "Ring",
  "Robbe", "Rose", "Sattel", "Schiff", "Spiegel", "Stern", "Stift", "Strand",
  "Sturm", "Tafel", "Tanne", "Taube", "Tomate", "Trommel", "Turm", "Ufer",
  "Vogel", "Vulkan", "Waage", "Wald", "Wind", "Wolf", "Zebra", "Zelt",
  "Zirkus", "Zitrone", "Zucker", "Zug", "Atlas", "Biene", "Donner", "Echo",
];

/** Passwortvorschlag „Wort-Wort-1234“ aus dem Zufall des Browsers. */
function suggestPassword() {
  const n = crypto.getRandomValues(new Uint32Array(3));
  const digits = String(n[2] % 10_000).padStart(4, "0");
  return `${WORDS[n[0] % WORDS.length]}-${WORDS[n[1] % WORDS.length]}-${digits}`;
}

const sameName = (value: string) => value.toLocaleLowerCase("de").replace(/\s+/g, " ").trim();
const words = (value: string) => sameName(value).split(" ").filter(Boolean);

/**
 * Vorschläge wortweise: ein Wort der Eingabe (ab 3 Zeichen) und ein Wort des
 * Profilnamens beginnen gleich. So findet „Kevin Antwi“ auch das Profil „Kevin“.
 */
function matchProfiles(profiles: TeamAccess["profiles"], input: string) {
  const typed = words(input).filter((w) => w.length >= 3);
  if (!typed.length) return [];
  return profiles
    .map((p) => {
      const own = words(p.name);
      const hits = typed.filter((t) =>
        own.some((w) => Math.min(w.length, t.length) >= 3 && (w.startsWith(t) || t.startsWith(w))),
      ).length;
      return { p, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.p.name.localeCompare(b.p.name, "de"))
    .slice(0, 6)
    .map((x) => x.p);
}

/** Nachricht an die Person, zum Kopieren. Keine Gedankenstriche. */
function accessMessage(result: Created, password: string, origin: string) {
  const first = result.name.trim().split(/\s+/)[0] || result.name;
  return [
    `Hi ${first}, dein Zugang zu Deal Operator steht.`,
    `Anmelden: ${origin}/anmelden`,
    `E-Mail: ${result.email}`,
    result.passwordSet
      ? `Passwort: ${password}`
      : "Passwort: das, das du bei der Registrierung gewählt hast",
    "Das Passwort kannst du danach unter Profil ändern.",
  ].join("\n");
}

type Field = "name" | "email" | "password";

/**
 * Zugang anlegen (nur Admins): Name, E-Mail und Passwort, direkt einem Profil
 * zugeordnet. Für Personen, deren Bestätigungsmail nicht ankommt. Das
 * Passwort bleibt nur in diesem Browser, bis die Nachricht kopiert ist.
 */
export function AccessPanel({
  access,
  onChanged,
  onInbox,
}: {
  access: TeamAccess;
  onChanged: () => void | Promise<void>;
  /** Zur Team-Inbox (Freischalten unter „Unbestätigt“). */
  onInbox?: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [participant, setParticipant] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ field: Field; message: string } | null>(null);
  const [done, setDone] = useState<{ result: Created; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const [leaving, setLeaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Nach dem Anlegen: Ergebnis in den Blick, damit es am Handy nicht unter dem Formular verschwindet.
  useEffect(() => {
    if (!done) return;
    doneRef.current?.focus();
    doneRef.current?.scrollIntoView({ block: "start" });
  }, [done]);

  const suggestions = participant ? [] : matchProfiles(access.profiles, name);

  function fail(field: Field, message: string) {
    setFieldError({ field, message });
    setTimeout(() => (field === "name" ? nameRef : field === "email" ? emailRef : passwordRef).current?.focus(), 0);
  }
  /** Fehler am Feld: markiert und mit der Meldung verbunden. */
  const invalid = (field: Field, hint?: string) => {
    const wrong = fieldError?.field === field;
    const describedBy = [hint, wrong ? `${id}-${field}-error` : ""].filter(Boolean).join(" ");
    return { "aria-invalid": wrong || undefined, "aria-describedby": describedBy || undefined };
  };
  const fieldMessage = (field: Field) =>
    fieldError?.field === field ? (
      <p className="form-error" id={`${id}-${field}-error`} role="alert">
        {fieldError.message}
      </p>
    ) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setFieldError(null);
    if (password.length < 8) {
      fail("password", "Das Passwort braucht mindestens 8 Zeichen.");
      return;
    }
    setBusy(true);
    try {
      const result = await adminPost<Created>("createAccess", {
        name,
        email,
        password,
        ...(participant ? { participant: participant.id } : {}),
      });
      setDone({ result, message: accessMessage(result, password, window.location.origin) });
      setCopied(false);
      setCopyHint("");
      setLeaving(false);
      setName("");
      setEmail("");
      setPassword("");
      setParticipant(null);
    } catch (e) {
      const f = e instanceof AdminError ? e.field : undefined;
      // Profilauswahl hängt am Namensfeld.
      const field: Field | null =
        f === "participant" || f === "name" ? "name" : f === "email" || f === "password" ? f : null;
      if (field) fail(field, (e as Error).message);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!done) return;
    setCopyHint("");
    try {
      await navigator.clipboard.writeText(done.message);
      setCopied(true);
    } catch {
      // Ohne Zwischenablage: Text markieren, damit er von Hand kopiert werden kann.
      const field = messageRef.current;
      field?.focus();
      field?.setSelectionRange(0, field.value.length);
      setCopyHint("Automatisch kopieren ging nicht. Der Text ist markiert: lange drücken und „Kopieren“ wählen.");
    }
  }

  /** Zurück zum Formular; erst jetzt neu laden, damit das Ergebnis nicht vorher verschwindet. */
  function next() {
    setDone(null);
    setLeaving(false);
    void onChanged();
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  return (
    <section className="adm-card" aria-labelledby="adm-access-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <KeyRound size={19} />
        </span>
        <div>
          <h2 id="adm-access-title">Zugang anlegen</h2>
          <p>
            Für Personen, bei denen die Bestätigungsmail nicht ankommt und die
            sich bei euch gemeldet haben. Der Zugang gehört direkt zum Profil;
            danach schickst du der Person die Anmeldedaten. Hat sich die Person
            schon registriert, reicht „Freischalten“ in der Team-Inbox unter
            „Unbestätigt“; dann bleibt ihr eigenes Passwort.
          </p>
          {onInbox && (
            <div className="adm-actions">
              <button type="button" className="btn secondary" onClick={onInbox}>
                <Inbox size={16} aria-hidden="true" /> Zur Team-Inbox
              </button>
            </div>
          )}
        </div>
      </div>
      {!access.ready ? (
        <p className="adm-hint">
          Diese Funktion wird mit Migration 0006 freigeschaltet. Bis dahin
          bleibt alles andere wie gewohnt.
        </p>
      ) : done ? (
        <div className="adm-access-done" ref={doneRef} tabIndex={-1}>
          <Feedback
            success={`Zugang für ${done.result.name} angelegt${done.result.created ? " (neues Profil)" : ""}.`}
          />
          {!done.result.passwordSet && (
            <p className="adm-feedback" data-tone="warn">
              Für diese Adresse gab es schon ein Konto. Dein eingegebenes Passwort wurde nicht gesetzt; die Person
              meldet sich mit ihrem eigenen Passwort an.
            </p>
          )}
          {done.result.earlier && (
            <p className="adm-feedback" data-tone="warn">
              Das Konto stammt aus einem früheren, abgebrochenen Versuch. Es gilt das Passwort von damals. Die
              Nachricht enthält das jetzt eingegebene; schick sie nur, wenn es dasselbe ist.
            </p>
          )}
          <label className="adm-access-label" htmlFor={`${id}-message`}>
            Nachricht an die Person
          </label>
          <textarea
            id={`${id}-message`}
            ref={messageRef}
            className="adm-access-message"
            readOnly
            rows={8}
            value={done.message}
            onFocus={(e) => e.currentTarget.select()}
          />
          {done.result.passwordSet && (
            <p className="adm-hint">
              Kopiere die Nachricht jetzt. Das Passwort wird nirgends gespeichert und ist danach nicht mehr zu sehen.
            </p>
          )}
          <div className="adm-actions">
            <button type="button" className="btn primary" onClick={() => void copy()}>
              <Copy size={16} aria-hidden="true" />
              {copied ? "Kopiert" : "Nachricht kopieren"}
            </button>
            {!leaving && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => (copied || !done.result.passwordSet ? next() : setLeaving(true))}
              >
                Weiteren Zugang anlegen
              </button>
            )}
          </div>
          {copyHint && (
            <p className="adm-hint" role="status">
              {copyHint}
            </p>
          )}
          {leaving && (
            <div className="adm-unlock">
              <p role="alert">Nachricht schon kopiert? Danach ist das Passwort nicht mehr zu sehen.</p>
              <button type="button" className="btn secondary" onClick={next}>
                Ja, weiter
              </button>
              <button type="button" className="btn secondary" onClick={() => setLeaving(false)}>
                Zurück
              </button>
            </div>
          )}
          {done.result.newAccount && (
            <p className="adm-hint">
              Supabase schickt zusätzlich eine Bestätigungsmail. Die kann die Person ignorieren.
            </p>
          )}
        </div>
      ) : (
        <form className="adm-form" onSubmit={submit} noValidate>
          <div className="adm-field">
            <label className="adm-access-label" htmlFor={`${id}-name`}>
              Name
            </label>
            <input
              id={`${id}-name`}
              ref={nameRef}
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldError?.field === "name") setFieldError(null);
                // Eigener Name statt Auswahl: das Profil ist nicht mehr gewählt.
                if (participant && sameName(e.target.value) !== sameName(participant.name)) setParticipant(null);
              }}
              {...invalid("name", `${id}-name-hint`)}
            />
            {fieldMessage("name")}
            {participant ? (
              <p className="adm-access-picked" id={`${id}-name-hint`}>
                <span>
                  Vorhandenes Profil: <strong>{participant.name}</strong>
                </span>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setParticipant(null)}
                  aria-label="Profilauswahl aufheben"
                >
                  <X size={15} aria-hidden="true" /> Aufheben
                </button>
              </p>
            ) : (
              <small id={`${id}-name-hint`}>
                Tipp den Namen ein. Steht die Person schon in der Rangliste, erscheint ihr Profil darunter; wähle es
                aus, damit ihre Zahlen dazugehören.
              </small>
            )}
            {suggestions.length > 0 && (
              <>
                <span className="adm-access-label" id={`${id}-suggest`}>
                  Vorhandene Profile ohne Konto:
                </span>
                <ul className="adm-access-suggest" aria-labelledby={`${id}-suggest`}>
                  {suggestions.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setParticipant(p);
                          setName(p.name);
                          setError("");
                          setFieldError(null);
                        }}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="adm-field">
            <label className="adm-access-label" htmlFor={`${id}-email`}>
              E-Mail
            </label>
            <input
              id={`${id}-email`}
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldError?.field === "email") setFieldError(null);
              }}
              {...invalid("email")}
            />
            {fieldMessage("email")}
          </div>
          <div className="adm-field">
            <label className="adm-access-label" htmlFor={`${id}-password`}>
              Passwort
            </label>
            <div className="adm-access-password">
              <input
                id={`${id}-password`}
                ref={passwordRef}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldError?.field === "password") setFieldError(null);
                }}
                {...invalid("password", `${id}-password-hint`)}
              />
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setPassword(suggestPassword());
                  if (fieldError?.field === "password") setFieldError(null);
                }}
              >
                <Sparkles size={16} aria-hidden="true" /> Vorschlag
              </button>
            </div>
            {fieldMessage("password")}
            <small id={`${id}-password-hint`}>
              Mindestens 8 Zeichen. Gibt es für die Adresse schon ein bestätigtes Konto, bleibt dessen Passwort.
            </small>
          </div>
          <Feedback error={error} />
          <div className="adm-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={busy || name.trim().length < 2 || !email.trim() || !password}
            >
              {busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
              Zugang anlegen
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Hängende Registrierung freischalten (nur Admins, nach Migration 0006). Mit
 * Zwischenschritt direkt im Eintrag. Bestätigt nur die Adresse; die Person
 * meldet sich mit ihrem eigenen Passwort an. Eine Mail geht dabei nicht raus.
 */
export function ConfirmRegistration({
  id,
  name,
  email,
  onDone,
}: {
  id: string;
  name: string;
  /** Die Adresse, die bestätigt wird; der Admin prüft sie vorher. */
  email?: string;
  /** Mit der Erfolgsmeldung, damit sie nach dem Neuladen stehen bleibt. */
  onDone?: (message: string) => void | Promise<void>;
}) {
  const uid = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const question = useRef<HTMLParagraphElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  // Fokus mitführen, wenn der Knopf durch die Rückfrage ersetzt wird und umgekehrt.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (asking) question.current?.focus();
    else start.current?.focus();
  }, [asking]);
  const ask = (value: boolean) => {
    moved.current = true;
    setAsking(value);
  };

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await adminPost<{ kind: "new" | "claim"; name: string; bound: boolean }>("confirmRegistration", { id });
      const message =
        `${r.name} ist freigeschaltet und kann sich jetzt anmelden. Sag kurz Bescheid; eine Mail geht dabei nicht raus.` +
        (r.kind === "claim" && r.bound ? " Die Übernahme liegt jetzt bei euch zur Prüfung." : "");
      setDone(message);
      setAsking(false);
      await onDone?.(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="adm-unlock">
        <p role="status">{done}</p>
      </div>
    );
  return (
    <div className="adm-unlock">
      {asking ? (
        <>
          <p ref={question} id={`${uid}-ask`} tabIndex={-1}>
            Nur freischalten, wenn sich {name} bei euch gemeldet hat und die Adresse{" "}
            {email ? <strong className="adm-unlock-email">{email}</strong> : "der Registrierung"} stimmt. Sie meldet
            sich danach mit ihrer E-Mail und ihrem Passwort an.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            aria-describedby={`${uid}-ask`}
            onClick={() => void run()}
          >
            {busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
            Jetzt freischalten
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => ask(false)}>
            Abbrechen
          </button>
        </>
      ) : (
        <button type="button" className="btn secondary" ref={start} onClick={() => ask(true)}>
          <KeyRound size={16} aria-hidden="true" />
          Freischalten
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
