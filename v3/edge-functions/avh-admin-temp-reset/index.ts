const textHeaders={'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};

Deno.serve((req)=>{
  if(req.method!=='GET'){
    return new Response('Metodo no permitido',{status:405,headers:{...textHeaders,'Allow':'GET'}});
  }

  const incoming=new URL(req.url);
  const token=incoming.searchParams.get('token')||'';
  if(!token){
    return new Response('Enlace invalido.',{status:400,headers:textHeaders});
  }

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  if(!supabaseUrl){
    return new Response('Servicio de recuperacion no disponible.',{status:503,headers:textHeaders});
  }

  // Legacy endpoint compatibility: never changes credentials itself.
  // Send old links to the hardened recovery form, which requires explicit POST.
  const target=new URL('/functions/v1/avh-admin-recover',supabaseUrl);
  target.searchParams.set('token',token);
  return new Response(null,{
    status:303,
    headers:{
      'Location':target.toString(),
      'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer'
    }
  });
});
