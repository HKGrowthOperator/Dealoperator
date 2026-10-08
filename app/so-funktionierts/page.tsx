import Link from "next/link";
import { Phone, NotebookPen, BarChart3, UsersRound, CalendarCheck, Bell, Flame } from "lucide-react";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { loadCommitmentSettings } from "@/server/settings";
import { defaultCommitmentSettings } from "@/lib/commitment";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "So funktioniert’s · Deal Operator",
  description: "Zahlen festhalten, gemeinsam dranbleiben und einen Call-Partner zum Üben finden.",
  alternates: { canonical: "/so-funktionierts" },
};
export default async function Page() {
  const actor = await getCurrentUser().catch(() => null);
  const settings = databaseReady() ? await loadCommitmentSettings(database()).catch(() => defaultCommitmentSettings) : defaultCommitmentSettings;
  const clock = (v: { hour: number; minute: number }) => `${v.hour}:${String(v.minute).padStart(2,"0")} Uhr`;
  return <div className="operator-site">
    <OperatorHeader viewer={viewerOf(actor)} />
    <main id="inhalt" className="do-page hw hw-simple">
      <header className="hw-head">
        <span className="hw-eyebrow">Dein Calling-Tag. Sichtbar gemacht.</span>
        <h1>Callen. Festhalten. Dranbleiben.</h1>
        <p>Sieh, was du und die anderen schaffen. Halte deinen Tag fest und finde jemanden, mit dem du besser wirst.</p>
        <div className="hw-cta"><Link className="do-button do-button-primary" href={actor ? "/tagesabschluss" : "/starten"}>{actor ? "Meinen Tag eintragen" : "Kostenfrei starten"}</Link><Link className="do-button do-button-secondary" href="/">Ergebnisse ansehen</Link></div>
      </header>
      <section className="hw-section" aria-labelledby="hw-day">
        <h2 id="hw-day">So läuft dein Tag</h2>
        <ol className="hw-steps">
          <li><div className="hw-step-text"><Phone size={24} aria-hidden="true" /><h3>Du callst</h3><p>Allein oder mit einem Call-Partner. Anwahlen, Settings und Closings hältst du am Ende fest.</p></div><div className="hw-visual hw-week" aria-hidden="true">{["Mo","Di","Mi","Do","Fr","Sa","So"].map((d,i) => <span key={d} data-on={settings.callingWeekdays.includes(i+1) || undefined}>{d}</span>)}</div></li>
          <li><div className="hw-step-text"><NotebookPen size={24} aria-hidden="true" /><h3>Du hältst deinen Tag fest</h3><p>Zahlen, Energie und eine kurze Reflexion: Was lief gut? Was probierst du beim nächsten Mal?</p></div><div className="hw-visual hw-form" aria-hidden="true"><span><small>Anwahlen</small><b>64</b></span><span><small>Settings</small><b>2</b></span><span><small>Closings</small><b>1</b></span><em>Beispiel</em></div></li>
          <li><div className="hw-step-text"><BarChart3 size={24} aria-hidden="true" /><h3>Du siehst deinen Fortschritt</h3><p>Deine Zahlen erscheinen in der Rangliste. Tag für Tag entsteht dein Verlauf.</p></div><div className="hw-visual hw-rank" aria-hidden="true">{[1,2,3].map((n,i) => <span key={n} data-place={n}><b>{n}</b><i style={{width:`${[92,70,48][i]}%`}} /></span>)}<em>Ein Tag. Gemeinsame Ergebnisse.</em></div></li>
        </ol>
      </section>
      <section className="hw-section" aria-labelledby="hw-routine"><h2 id="hw-routine">Was dir beim Dranbleiben hilft</h2><div className="hw-benefits">
        <article><Flame size={26} aria-hidden="true" /><h3>Deine Serie</h3><p>Ein rechtzeitiger Tagesabschluss verlängert deine Serie. Wochenenden und bestätigte Pausen unterbrechen sie nicht.</p></article>
        <article><UsersRound size={26} aria-hidden="true" /><h3>Ein Call-Partner</h3><p>Zeig, wann du Zeit hast und was du üben möchtest. Anfragen und Abstimmung laufen direkt hier.</p><Link className="do-link" href="/partner?modus=eigen">Call-Partner finden</Link></article>
        <article><CalendarCheck size={26} aria-hidden="true" /><h3>Gemeinsame Calls</h3><p>Roleplay, Einwände oder ein zusätzlicher Call-Block. Zusagen und zum Termin den Google-Call öffnen. Ohne Level-Hürde.</p><Link className="do-link" href="/sessions?modus=eigen">Termine ansehen</Link></article>
      </div></section>
      <section className="hw-section" aria-labelledby="hw-questions"><h2 id="hw-questions">Noch eine Frage?</h2><div className="hw-details">
        <details><summary>Meine Zahlen sind schon hier. Wie übernehme ich sie?</summary><p>Wähle deinen Namen in der Rangliste und „Das sind meine Zahlen“. Nach der Prüfung gehören alle bisherigen Tage zu deinem Konto.</p><Link className="do-link" href="/starten?weg=profil">Mein Profil auswählen</Link></details>
        <details><summary>Kann ich Zahlen nachtragen oder korrigieren?</summary><p>Ja. Unter Mein Tag wählst du das passende Datum. Die Zahlen zählen im Ranking. Für deine Serie muss der Abschluss bis {settings.deadlineHour}:00 Uhr am nächsten Calling-Tag eingehen.</p></details>
        <details><summary>Wie schalte ich Erinnerungen ein?</summary><p><Bell size={16} aria-hidden="true" /> Nach einer Call-Zusage oder im Profil kannst du Benachrichtigungen erlauben. Für deinen Tagesabschluss erinnern wir dich um {clock(settings.eveningReminder)}, wenn er noch fehlt. Du kannst sie jederzeit im Profil ausschalten.</p></details>
      </div></section>
    </main><OperatorFooter showAdmin={!!actor && isTeam(actor)} />
  </div>;
}
