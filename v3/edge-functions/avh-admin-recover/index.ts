import { createClient } from 'npm:@supabase/supabase-js@2';

const securityHeaders={
  'Content-Type':'text/html; charset=utf-8',
  'Cache-Control':'no-store, max-age=0',
  'Pragma':'no-cache',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]||c));
const page=(body:string)=>`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recuperar acceso AVH</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f4f7f5;margin:0;padding:22px;color:#173126}.wrap{max-width:460px;margin:40px auto;background:#fff;border:1px solid #dfe7e1;border-radius:18px;padding:24px;box-shadow:0 8px 30px #0000000a}h2{color:#156E38}label{display:block;font-weight:700;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd8cf;border-radius:12px;font-size:16px}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#156E38;color:#fff;font-weight:800;font-size:16px}.muted{color:#6c7c73;font-size:14px}.ok{background:#edf8f0;padding:14px;border-radius:12px}.err{background:#fff1f1;padding:14px;border-radius:12px;color:#9f2424}</style></head><body><div class="wrap">${body}</div></body></html>`;
const response=(body:string,status=200)=>new Response(page(body),{status,headers:securityHeaders});

async function sha256(v:string){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function validPassword(p:string){
  return p.length>=10&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);
}

Deno.serve(async(req)=>{
  if(!['GET','POST'].includes(req.method))return response('<h2>Recuperar acceso AVH</h2><div class="err">Método no permitido.</div>',405);

  const url=Deno.env.get('SUPABASE_URL');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!service)return response('<h2>Recuperar acceso AVH</h2><div class="err">Recuperación no disponible.</div>',503);

  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const u=new URL(req.url);

  if(req.method==='POST'){
    const type=req.headers.get('content-type')||'';
    if(!type.toLowerCase().includes('application/x-www-form-urlencoded')&&!type.toLowerCase().includes('multipart/form-data')){
      return response('<h2>Recuperar acceso AVH</h2><div class="err">Solicitud inválida.</div>',400);
    }
    const f=await req.formData();
    const token=String(f.get('token')||'');
    const password=String(f.get('password')||'');
    const confirm=String(f.get('confirm')||'');
    if(!token)return response('<h2>Recuperar acceso AVH</h2><div class="err">Enlace inválido.</div>',400);
    if(password!==confirm||!validPassword(password)){
      return response('<h2>Recuperar acceso AVH</h2><div class="err">Las contraseñas no coinciden o no cumplen la seguridad mínima.</div><p class="muted">Usá al menos 10 caracteres, con mayúscula, minúscula y número.</p>',400);
    }

    const hash=await sha256(token);
    const {data:recovery}=await admin.from('admin_recovery_tokens').select('id,username,expires_at,used_at').eq('token_hash',hash).maybeSingle();
    if(!recovery||recovery.used_at||new Date(recovery.expires_at)<=new Date()){
      return response('<h2>Recuperar acceso AVH</h2><div class="err">Este enlace venció o ya fue utilizado.</div>',403);
    }
    const {data:profile}=await admin.from('profiles').select('id,role,active').eq('username',recovery.username).maybeSingle();
    if(!profile||profile.role!=='admin'||!profile.active){
      return response('<h2>Recuperar acceso AVH</h2><div class="err">Cuenta administrativa no disponible.</div>',403);
    }

    const {error}=await admin.auth.admin.updateUserById(profile.id,{password});
    if(error){
      console.error('AVH admin recovery password update failed',error.message);
      return response('<h2>Recuperar acceso AVH</h2><div class="err">No se pudo actualizar la contraseña. Solicitá un enlace nuevo.</div>',400);
    }
    const usedAt=new Date().toISOString();
    await admin.from('profiles').update({must_change_password:false,password_changed_at:usedAt}).eq('id',profile.id);
    await admin.from('admin_recovery_tokens').update({used_at:usedAt}).eq('id',recovery.id);
    return response('<h2>Contraseña actualizada</h2><div class="ok"><b>Listo.</b> Ya podés volver a Inventario AVH e ingresar con tu nueva contraseña.</div>');
  }

  const token=u.searchParams.get('token')||'';
  if(!token)return response('<h2>Recuperar acceso AVH</h2><div class="err">Falta el código de recuperación.</div>',400);
  const hash=await sha256(token);
  const {data:recovery}=await admin.from('admin_recovery_tokens').select('expires_at,used_at').eq('token_hash',hash).maybeSingle();
  if(!recovery||recovery.used_at||new Date(recovery.expires_at)<=new Date()){
    return response('<h2>Recuperar acceso AVH</h2><div class="err">Este enlace venció o ya fue utilizado.</div>',403);
  }
  return response(`<h2>Recuperar acceso AVH</h2><p class="muted">Elegí una contraseña nueva para la cuenta administradora.</p><form method="POST"><input type="hidden" name="token" value="${esc(token)}"><label>Nueva contraseña</label><input name="password" type="password" minlength="10" required autocomplete="new-password"><label>Confirmar contraseña</label><input name="confirm" type="password" minlength="10" required autocomplete="new-password"><button type="submit">Guardar nueva contraseña</button></form><p class="muted">Mínimo 10 caracteres, con mayúscula, minúscula y número.</p>`);
});
