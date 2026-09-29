import { createClient } from 'npm:@supabase/supabase-js@2';

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]||c));
const html=(body:string)=>`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recuperar acceso AVH</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f4f7f5;margin:0;padding:22px;color:#173126}.wrap{max-width:460px;margin:40px auto;background:#fff;border:1px solid #dfe7e1;border-radius:18px;padding:24px;box-shadow:0 8px 30px #0000000a}h2{color:#156E38}label{display:block;font-weight:700;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd8cf;border-radius:12px;font-size:16px}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#156E38;color:#fff;font-weight:800;font-size:16px}.muted{color:#6c7c73;font-size:14px}.ok{background:#edf8f0;padding:14px;border-radius:12px}.err{background:#fff1f1;padding:14px;border-radius:12px;color:#9f2424}</style></head><body><div class="wrap">${body}</div></body></html>`;

async function sha256(v:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}

Deno.serve(async(req)=>{
 const url=Deno.env.get('SUPABASE_URL')!;
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const u=new URL(req.url);
 let token='';
 if(req.method==='GET') token=u.searchParams.get('token')||'';
 else if(req.method==='POST'){const f=await req.formData();token=String(f.get('token')||'');const p=String(f.get('password')||'');const c=String(f.get('confirm')||'');
   if(!token)return new Response(html('<h2>Recuperar acceso AVH</h2><div class="err">Enlace inválido.</div>'),{status:400,headers:{'Content-Type':'text/html; charset=utf-8'}});
   if(p!==c||p.length<10||!/[A-Z]/.test(p)||!/[a-z]/.test(p)||!/[0-9]/.test(p))return new Response(html(`<h2>Recuperar acceso AVH</h2><div class="err">Las contraseñas no coinciden o no cumplen la seguridad mínima.</div><p class="muted">Usá al menos 10 caracteres, con mayúscula, minúscula y número.</p>`),{status:400,headers:{'Content-Type':'text/html; charset=utf-8'}});
   const h=await sha256(token);
   const {data:r}=await admin.from('admin_recovery_tokens').select('id,username,expires_at,used_at').eq('token_hash',h).maybeSingle();
   if(!r||r.used_at||new Date(r.expires_at)<=new Date())return new Response(html('<h2>Recuperar acceso AVH</h2><div class="err">Este enlace venció o ya fue utilizado.</div>'),{status:403,headers:{'Content-Type':'text/html; charset=utf-8'}});
   const {data:prof}=await admin.from('profiles').select('id,role,active').eq('username',r.username).maybeSingle();
   if(!prof||prof.role!=='admin'||!prof.active)return new Response(html('<h2>Recuperar acceso AVH</h2><div class="err">Cuenta administrativa no disponible.</div>'),{status:403,headers:{'Content-Type':'text/html; charset=utf-8'}});
   // Atomically consume the token before changing Auth. A failed reset requires a new token.
   const {data:claim,error:claimError}=await admin.from('admin_recovery_tokens')
     .update({used_at:new Date().toISOString()}).eq('id',r.id).is('used_at',null)
     .gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
   if(claimError||!claim)return new Response('Este enlace venció o ya fue utilizado.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
   const {error:e}=await admin.auth.admin.updateUserById(prof.id,{password:p});
   if(e)return new Response(html(`<h2>Recuperar acceso AVH</h2><div class="err">${esc(e.message)}</div>`),{status:400,headers:{'Content-Type':'text/html; charset=utf-8'}});
   await admin.from('profiles').update({must_change_password:false,password_changed_at:new Date().toISOString()}).eq('id',prof.id);
   return new Response(html('<h2>Contraseña actualizada</h2><div class="ok"><b>Listo.</b> Ya podés volver a Inventario AVH e ingresar con <b>admin.avh</b> y tu nueva contraseña.</div>'),{headers:{'Content-Type':'text/html; charset=utf-8'}});
 }
 if(req.method!=='GET')return new Response('Método no permitido',{status:405});
 if(!token)return new Response(html('<h2>Recuperar acceso AVH</h2><div class="err">Falta el código de recuperación.</div>'),{status:400,headers:{'Content-Type':'text/html; charset=utf-8'}});
 const h=await sha256(token);const {data:r}=await admin.from('admin_recovery_tokens').select('expires_at,used_at').eq('token_hash',h).maybeSingle();
 if(!r||r.used_at||new Date(r.expires_at)<=new Date())return new Response(html('<h2>Recuperar acceso AVH</h2><div class="err">Este enlace venció o ya fue utilizado.</div>'),{status:403,headers:{'Content-Type':'text/html; charset=utf-8'}});
 return new Response(html(`<h2>Recuperar acceso AVH</h2><p class="muted">Elegí una contraseña nueva para <b>admin.avh</b>.</p><form method="POST"><input type="hidden" name="token" value="${esc(token)}"><label>Nueva contraseña</label><input name="password" type="password" minlength="10" required autocomplete="new-password"><label>Confirmar contraseña</label><input name="confirm" type="password" minlength="10" required autocomplete="new-password"><button type="submit">Guardar nueva contraseña</button></form><p class="muted">Mínimo 10 caracteres, con mayúscula, minúscula y número.</p>`),{headers:{'Content-Type':'text/html; charset=utf-8'}});
});
