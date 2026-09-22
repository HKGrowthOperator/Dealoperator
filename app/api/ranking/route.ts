import {database,databaseReady} from '@/server/database';
import {publicRanking} from '@/server/operator';
import {berlinDate,daySchema} from '@/lib/kpis';
import {json,errorResponse} from '@/server/http';
export async function GET(request:Request){try{const search=new URL(request.url).searchParams;const from=daySchema.parse(search.get('from')||berlinDate());const to=daySchema.parse(search.get('to')||berlinDate());if(from>to)return json({error:'Der Beginn muss vor dem Ende liegen.'},400);if(!databaseReady())return json({ready:false,rows:[]});return json({ready:true,rows:await publicRanking(database(),from,to)})}catch(e){return errorResponse(e)}}
