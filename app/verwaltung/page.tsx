import {getCurrentUser} from '@/server/auth';
import {OperatorHeader,OperatorFooter} from '../features/operator-shell';
import ImportConsole from '../features/import-console';
export const dynamic='force-dynamic';
export default async function Page(){const actor=await getCurrentUser();return <div className="operator-site"><OperatorHeader/><ImportConsole admin={actor?.admin||false} signedIn={!!actor}/><OperatorFooter/></div>}
