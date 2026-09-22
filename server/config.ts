import type { PoolConfig } from "pg";

export function configurationIssues(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const issues: string[] = [];
  for (const key of [
    "APP_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "DATABASE_URL",
  ])
    if (!env[key]?.trim()) issues.push(`${key} fehlt.`);
  for (const key of ["APP_URL", "SUPABASE_URL"]) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]!);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
        url.hostname,
      );
      if (
        url.username ||
        url.password ||
        (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
      )
        issues.push(`${key} muss eine HTTPS-Adresse ohne Zugangsdaten sein.`);
      if (url.pathname !== "/" || url.search || url.hash)
        issues.push(`${key} darf keinen Pfad oder URL-Zusatz enthalten.`);
    } catch {
      issues.push(`${key} ist keine gültige Adresse.`);
    }
  }
  if (env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_secret_"))
    issues.push("SUPABASE_PUBLISHABLE_KEY darf kein Secret-Key sein.");
  if (env.DATABASE_URL) {
    try {
      connectionOptions(env);
    } catch (error) {
      issues.push((error as Error).message);
    }
  }
  return issues;
}

export function connectionOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PoolConfig {
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL || "");
  } catch {
    throw Error("DATABASE_URL ist keine gültige PostgreSQL-Adresse.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("DATABASE_URL muss PostgreSQL verwenden.");
  if (url.port === "6543")
    throw Error(
      "DATABASE_URL muss eine direkte Verbindung oder den Session-Pooler auf Port 5432 verwenden.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const sslDisabled = env.DATABASE_SSL === "disable";
  if (sslDisabled && !local)
    throw Error(
      "DATABASE_SSL=disable ist ausschließlich für eine lokale Datenbank erlaubt.",
    );
  // node-postgres merges connection-string parameters over the sibling options
  // below, so "ssl" would silently turn off the verified TLS built here and
  // "options" would silently replace the session search_path. Both are refused
  // loudly instead of stripped, so the connection string is corrected rather
  // than quietly reinterpreted.
  for (const key of ["ssl", "options"])
    if (url.searchParams.has(key))
      throw Error(
        `DATABASE_URL darf keinen ${key}-Parameter enthalten. TLS und Suchpfad setzt der Server selbst.`,
      );
  // URL ssl options otherwise override pg's verified TLS configuration.
  for (const key of [
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: sslDisabled
      ? false
      : {
          rejectUnauthorized: true,
          ...(env.DATABASE_SSL_CA
            ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, "\n") }
            : {}),
        },
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    options: "-c search_path=operator,pg_catalog -c statement_timeout=15000",
  };
}
