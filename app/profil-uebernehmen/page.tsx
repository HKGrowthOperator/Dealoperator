import {getCurrentUser} from '@/server/auth';
import {OperatorHeader,OperatorFooter} from '../features/operator-shell';
import ClaimProfile from '../features/claim-profile';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){const p=await searchParams;return <div className="operator-site"><OperatorHeader/><main className="auth-layout"><ClaimProfile signedIn={!!await getCurrentUser()} profileId={p.profil||''}/></main><OperatorFooter/></div>}
