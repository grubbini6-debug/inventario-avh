// The caller's role comes from profiles, never from user-editable Auth metadata.
export const corsHeaders={'Access-Control-Allow-Origin':'https://grubbini6-debug.github.io','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
export const json=(body,status=200)=>Response.json(body,{status,headers:corsHeaders});
export const validPassword=p=>p.length>=10&&p.length<=256&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);
export const validUsername=u=>/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(u)&&!['admin','admin.avh','administrador','administrador.avh'].includes(u);
export const uuid=u=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u);
export async function authorizeAdmin(req){
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const authorization=req.headers.get('Authorization')||'';
 if(!authorization.startsWith('Bearer ')||!authorization.slice(7).trim())return{error:json({error:'Sesión inválida. Volvé a ingresar.'},401)};
 const call=async(path,body,method=body===undefined?'GET':'POST',credential=service)=>{
  const r=await fetch(url+path,{method,headers:{apikey:credential,Authorization:credential===key?authorization:'Bearer '+credential,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>null);return{data,error:!r.ok,status:r.status};
 };
 const user=await call('/auth/v1/user',undefined,'GET',key);
 if(user.error||!uuid(user.data?.id||''))return{error:json({error:'Sesión vencida. Volvé a ingresar.'},401)};
 const p=await call('/rest/v1/profiles?select=id,username,role,active&id=eq.'+user.data.id);
 const profile=p.data?.[0];
 if(p.error||!profile?.active||profile.role!=='admin')return{error:json({error:'Solo un administrador activo puede gestionar usuarios.'},403)};
 return{profile,call};
}
