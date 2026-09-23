/**
 * Startet den serverseitigen Takt für Erinnerungen, Team-Hinweise und
 * Discord. Nur im Node-Server, nur mit Datenbank, nie beim Build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
