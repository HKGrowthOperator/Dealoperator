/**
 * Kurze Team-E-Mails als Absicherung zu Push-Meldungen.
 *
 * Läuft über die Resend-HTTP-API mit einem eigenen Schlüssel aus der
 * Serverumgebung. Der bestehende Auth-Mailversand (Supabase → Resend-SMTP)
 * wird davon nicht berührt: kein gemeinsamer Schlüssel, keine Änderung an
 * den Supabase-Einstellungen.
 *
 * Fehlt die Konfiguration, wird nicht still verworfen: der Grund wird
 * zurückgegeben und im Versandprotokoll sichtbar.
 */
export type MailResult =
  | { status: "sent"; id: string }
  | { status: "skipped"; reason: string };

export function mailConfigIssues(env = process.env): string[] {
  const issues: string[] = [];
  if (!env.RESEND_API_KEY?.trim())
    issues.push("RESEND_API_KEY fehlt (eigener Resend-API-Schlüssel für Team-E-Mails).");
  if (!env.NOTIFY_FROM?.trim())
    issues.push(
      "NOTIFY_FROM fehlt (Absender auf einer in Resend verifizierten Domain, z. B. „Deal Operator <team@…>“).",
    );
  return issues;
}

export async function sendMail(
  message: { to: string; subject: string; text: string; idempotencyKey?: string },
  env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<MailResult> {
  const issues = mailConfigIssues(env);
  if (issues.length) return { status: "skipped", reason: issues.join(" ") };
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
      "Content-Type": "application/json",
      // Resend verschickt dieselbe Nachricht bei gleichem Schlüssel nur einmal
      // (24 h) — Schutz gegen Doppelversand nach Absturz oder Wiederholung.
      ...(message.idempotencyKey
        ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) }
        : {}),
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM!.trim(),
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Keine Antwortdetails protokollieren: sie können den Schlüssel spiegeln.
    throw Error(`Resend antwortet mit ${response.status}.`);
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { status: "sent", id: data.id || "" };
}
