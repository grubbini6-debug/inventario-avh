import {authorizeAdmin,corsHeaders,json,validPassword,validUsername,uuid} from '../_shared/admin-users.mjs';
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 try{
  const auth=await authorizeAdmin(req);if(auth.error)return auth.error;
  const {profile,call}=auth;
  const body=await req.json(),username=String(body.username||'').trim().toLowerCase(),password=String(body.password||''),fullName=String(body.full_name||'').trim();
  const role=body.role??'depositor',warehouseId=String(body.warehouse_id||'').trim();
  const location=String(body.work_location||'').trim(),inventoryWarehouseId=String(body.inventory_warehouse_id||'').trim();
  if(!['depositor','production','admin_viewer'].includes(role))return json({error:'Elegí Depositario, Producción o Administrador de solo lectura.'},400);
  if(!validUsername(username)||fullName.length>200)return json({error:'Revisá el usuario (3–40 caracteres) y el nombre de la persona.'},400);
  if(!validPassword(password))return json({error:'La clave temporal debe tener mínimo 10 caracteres, mayúscula, minúscula y número.'},400);
  if(role!=='depositor'&&warehouseId)return json({error:'Este perfil se crea sin depósito asignado.'},400);
  if(location.length>200||(inventoryWarehouseId&&!uuid(inventoryWarehouseId)))return json({error:'Revisá el lugar y el inventario elegido.'},400);
  if(role!=='production'&&(location||inventoryWarehouseId))return json({error:'El lugar y la consulta de inventario corresponden al perfil de Producción.'},400);
  if(role==='depositor'&&!uuid(warehouseId))return json({error:'Elegí el depósito que va a manejar.'},400);
  const existing=await call('/rest/v1/profiles?select=id&username=eq.'+encodeURIComponent(username));
  if(existing.error)return json({error:'No se pudo verificar el usuario. Reintentá.'},500);
  if(existing.data.length)return json({error:'Ese usuario ya existe. Usá Gestionar.'},409);
  let warehouse=null;
  if(role==='depositor'){
   const r=await call('/rest/v1/warehouses?select=id,name,active&id=eq.'+warehouseId);warehouse=r.data?.[0];
   if(r.error||!warehouse?.active)return json({error:'El depósito elegido no existe o está inactivo.'},400);
  }
  const created=await call('/auth/v1/admin/users',{email:username+'@avh.local',password,email_confirm:true,user_metadata:{username}});
  const id=created.data?.id;
  if(created.error||!uuid(id||''))return json({error:/already|registered|exists/i.test(created.data?.msg||created.data?.message||'')?'Ese usuario ya existe en el acceso del sistema.':'No se pudo crear el acceso del usuario.'},400);
  const rollback=async()=>{
   const r=await call('/auth/v1/admin/users/'+id,undefined,'DELETE');
   if(r.error)console.error('Falló la limpieza del alta incompleta',id);
  };
  try{
   const name=fullName.toLowerCase()===profile.username.toLowerCase()?null:fullName||null;
   if(role==='production'){
    const r=await call('/rest/v1/rpc/provision_work_order_user',{p_user_id:id,p_username:username,p_full_name:name,p_actor_id:profile.id,p_work_location:location||null,p_inventory_warehouse_id:inventoryWarehouseId||null});
    if(r.error||r.data?.user?.role!=='production'||r.data.user.warehouse_id!==null||!r.data.user.active||!r.data.user.must_change_password||(r.data.user.work_location||'')!==location||(r.data.user.inventory_warehouse_id||'')!==inventoryWarehouseId){await rollback();return json({error:'No se pudo completar el perfil y su acceso a Órdenes de Trabajo.'},500);}
    return json(r.data);
   }
   const assignedWarehouse=role==='depositor'?warehouseId:null;
   const r=await call('/rest/v1/profiles',{id,username,full_name:name,role,warehouse_id:assignedWarehouse,active:true,must_change_password:true,password_changed_at:null});
   if(r.error){await rollback();return json({error:'No se pudo guardar el perfil del usuario.'},500);}
   const check=await call('/rest/v1/profiles?select=id,username,full_name,role,warehouse_id,active,must_change_password&id=eq.'+id),user=check.data?.[0];
   if(check.error||!user||user.role!==role||user.warehouse_id!==assignedWarehouse||!user.active||!user.must_change_password){await rollback();return json({error:'La verificación final del usuario falló.'},500);}
   return json({ok:true,user,warehouse:warehouse?{id:warehouse.id,name:warehouse.name}:null});
  }catch(err){await rollback();throw err;}
 }catch{
  return json({error:'No se pudo completar el alta. Revisá la lista de usuarios antes de reintentar.'},500);
 }
});
