// AVH V3 — Cliente HTTP/Supabase y persistencia de sesión.
function saveSession(s){session=s;if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SESSION_KEY)}
function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
let sessionRefreshPromise=null;
async function refreshSession(){
  if(sessionRefreshPromise)return sessionRefreshPromise;
  if(!session?.refresh_token)return false;
  const original=session;
  sessionRefreshPromise=(async()=>{
    try{
      const r=await fetch(`${API}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:original.refresh_token})});
      // A logout or a different login must win over an older refresh response.
      if(session!==original)return false;
      if(!r.ok){if(r.status===400||r.status===401)saveSession(null);return false}
      const d=await r.json();
      if(session!==original)return false;
      saveSession({...d,expires_at:Date.now()+Number(d.expires_in||3600)*1000});return true;
    }catch{return false}
  })();
  try{return await sessionRefreshPromise}finally{sessionRefreshPromise=null}
}
async function request(path,opt={},retry=true){if(session?.expires_at&&Date.now()>session.expires_at-45000)await refreshSession();const headers={apikey:KEY,...(opt.headers||{})};if(session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;if(opt.body!==undefined&&!headers['Content-Type'])headers['Content-Type']='application/json';try{const r=await fetch(API+path,{method:opt.method||'GET',headers,body:opt.body===undefined?undefined:(headers['Content-Type']==='application/json'?JSON.stringify(opt.body):opt.body)});if(r.status===401&&retry&&session?.refresh_token&&await refreshSession())return request(path,opt,false);const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)return{error:(data&&typeof data==='object'&&(data.message||data.msg||data.error))||`Error ${r.status}`,status:r.status};return{data,status:r.status,headers:r.headers}}catch{return{error:'No se pudo conectar con el servidor. Revisá tu conexión.',network:true}}}
async function query(table,select='*',extra=''){return request(`/rest/v1/${table}?select=${encodeURIComponent(select)}${extra?'&'+extra:''}`)}
async function queryAll(table,select='*',extra='',pageSize=1000,maxRows=100000){
  const rows=[];let offset=0,last=null;
  while(offset<maxRows){
    const paging=[extra,`limit=${pageSize}`,`offset=${offset}`].filter(Boolean).join('&');
    const r=await query(table,select,paging);last=r;
    if(r.error)return r;
    const page=Array.isArray(r.data)?r.data:[];
    rows.push(...page);
    if(page.length<pageSize)return{data:rows,status:r.status,headers:r.headers,complete:true};
    offset+=page.length;
  }
  return{data:rows,status:last?.status,headers:last?.headers,complete:false,truncated:true,error:`La consulta de ${table} superó el límite de seguridad de ${maxRows} filas.`};
}
async function insert(table,body,object=false){return request(`/rest/v1/${table}`,{method:'POST',headers:{Prefer:object?'return=representation':'return=minimal',...(object?{Accept:'application/vnd.pgrst.object+json'}:{})},body})}
async function patch(table,filter,body){return request(`/rest/v1/${table}?${filter}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body})}
async function upsert(table,body){return request(`/rest/v1/${table}`,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body})}
const STOCK_MUTATION_RPCS=new Set(['record_initial_inventory','record_entry','record_exit','record_transfer','record_return','receive_purchase']);
const OPERATION_REQUEST_IDS_KEY='avh_operation_request_ids_v1',OPERATION_REQUEST_ID_TTL=24*60*60*1000;
function canonicalOperationValue(v){if(Array.isArray(v))return v.map(canonicalOperationValue);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort()){if(k!=='request_id')o[k]=canonicalOperationValue(v[k])}return o}return v}
function operationFingerprint(name,args){return name+':'+JSON.stringify(canonicalOperationValue(args))}
function readOperationRequestIds(){try{const v=JSON.parse(localStorage.getItem(OPERATION_REQUEST_IDS_KEY)||'{}');return v&&typeof v==='object'?v:{}}catch{return{}}}
function writeOperationRequestIds(v){try{localStorage.setItem(OPERATION_REQUEST_IDS_KEY,JSON.stringify(v))}catch{}}
function prepareOperationRequest(name,args){
  if(!STOCK_MUTATION_RPCS.has(name)||!Array.isArray(args?.p_items)||!args.p_items.length)return{body:args};
  if(args.p_items[0]?.request_id)return{body:args};
  const now=Date.now(),store=readOperationRequestIds();
  for(const [k,v] of Object.entries(store))if(!v?.created_at||now-v.created_at>OPERATION_REQUEST_ID_TTL)delete store[k];
  const key=operationFingerprint(name,args),requestId=store[key]?.id||crypto.randomUUID();
  store[key]={id:requestId,created_at:store[key]?.created_at||now};writeOperationRequestIds(store);
  return{key,requestId,body:{...args,p_items:args.p_items.map((item,index)=>index===0?{...item,request_id:requestId}:item)}};
}
function clearOperationRequestId(key,requestId){if(!key)return;const store=readOperationRequestIds();if(store[key]?.id===requestId){delete store[key];writeOperationRequestIds(store)}}
async function rpc(name,args={}){
  const op=prepareOperationRequest(name,args);
  const result=await request(`/rest/v1/rpc/${name}`,{method:'POST',body:op.body});
  const uncertain=result?.network||result?.status===408||result?.status===429||Number(result?.status)>=500;
  if(op.key&&!uncertain)clearOperationRequestId(op.key,op.requestId);
  return result;
}
async function edge(name,args){return request(`/functions/v1/${name}`,{method:'POST',body:args})}
