import { getCurrentUser } from "@/server/auth";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import ImportConsole from "../features/import-console";
import ReviewQueue from "../features/review-queue";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUser();
  return (
    <div className="operator-site">
      <OperatorHeader />
      {actor?.admin && (
        <main className="admin-layout">
          <ReviewQueue admin />
        </main>
      )}
      <ImportConsole admin={actor?.admin || false} signedIn={!!actor} />
      <OperatorFooter />
    </div>
  );
}
