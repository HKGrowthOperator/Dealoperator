const destinations = new Set([
  "/heute",
  "/zahlen",
  "/reflexion",
  "/crew",
  "/sessions",
  "/wissen",
  "/profil",
  "/community",
  "/profil-uebernehmen",
  "/verwaltung",
  "/ranking",
]);
export function safeNext(value: string | null) {
  if (!value || !/^\/(?!\/)[a-zA-Z0-9/_?=&-]*$/.test(value))
    return "/heute?modus=eigen";
  const url = new URL(value, "https://operator.invalid");
  return destinations.has(url.pathname) ? value : "/heute?modus=eigen";
}
