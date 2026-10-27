import {authorizeAdmin,corsHeaders,json,validPassword,uuid} from '../_shared/admin-users.mjs';
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 try{
  const auth=await authorizeAdmin(req);if(auth.error)return auth.error;
  const {profile,call}=auth,body=await req.json(),id=String(body.user_id||''),password=String(body.password||'');
  if(!uuid(id))return json({error:'Elegí un usuario.'},400);
  if(id===profile.id)return json({error:'La cuenta administradora se gestiona por separado.'},400);
  if(!validPassword(password))return json({error:'La clave temporal debe tener mínimo 10 caracteres, mayúscula, minúscula y número.'},400);
  const r=await call('/rest/v1/profiles?select=id,username,role,active&id=eq.'+id),target=r.data?.[0];
  if(r.error||!target||!['depositor','production','admin_viewer'].includes(target.role))return json({error:'Elegí un usuario de Depósito, Producción o Solo lectura.'},400);
  const changed=await call('/auth/v1/admin/users/'+id,{password},'PUT');
  if(changed.error)return json({error:'No se pudo restablecer la clave. Elegí una contraseña distinta y reintentá.'},400);
  const marked=await call('/rest/v1/profiles?id=eq.'+id+'&role=eq.'+target.role,{must_change_password:true,password_changed_at:null},'PATCH');
  if(marked.error)return json({error:'La clave cambió, pero no se pudo marcar el cambio obligatorio. Reintentá antes de entregarla.'},500);
  return json({ok:true,user:{id:target.id,username:target.username,must_change_password:true}});
 }catch{return json({error:'No se pudo restablecer la contraseña.'},500);}
});
