import { createClient } from 'npm:@supabase/supabase-js@2';

async function sha256(v:string){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function randomPassword(){
  const upper='ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower='abcdefghijkmnopqrstuvwxyz';
  const nums='23456789';
  const all=upper+lower+nums;
  const a=new Uint32Array(14); crypto.getRandomValues(a);
  let s=upper[a[0]%upper.length]+lower[a[1]%lower.length]+nums[a[2]%nums.length];
  for(let i=3;i<a.length;i++) s+=all[a[i]%all.length];
  return s;
}
Deno.serve(async(req)=>{
  if(req.method!=='GET') return new Response('Metodo no permitido',{status:405,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const u=new URL(req.url);
  const token=u.searchParams.get('token')||'';
  const confirm=u.searchParams.get('confirm')||'';
  if(!token||confirm!=='RESET') return new Response('Enlace invalido.',{status:400,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const url=Deno.env.get('SUPABASE_URL')!;
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const h=await sha256(token);
  const {data:r}=await admin.from('admin_recovery_tokens').select('id,username,expires_at,used_at').eq('token_hash',h).maybeSingle();
  if(!r||r.used_at||new Date(r.expires_at)<=new Date()) return new Response('Este enlace vencio o ya fue utilizado.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const {data:p}=await admin.from('profiles').select('id,role,active').eq('username',r.username).maybeSingle();
  if(!p||p.role!=='admin'||!p.active) return new Response('Cuenta administrativa no disponible.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  // Atomically consume the token before changing Auth. A failed reset requires a new token.
  const {data:claim,error:claimError}=await admin.from('admin_recovery_tokens')
    .update({used_at:new Date().toISOString()}).eq('id',r.id).is('used_at',null)
    .gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
  if(claimError||!claim)return new Response('Este enlace venció o ya fue utilizado.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  const temp=randomPassword();
  const {error}=await admin.auth.admin.updateUserById(p.id,{password:temp});
  if(error) return new Response('No se pudo restablecer la contrasena.',{status:500,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  await admin.from('profiles').update({must_change_password:true,password_changed_at:null}).eq('id',p.id);
  return new Response('OK\nUsuario: admin.avh\nContrasena temporal: '+temp+'\nDebes cambiarla al ingresar.',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
});
