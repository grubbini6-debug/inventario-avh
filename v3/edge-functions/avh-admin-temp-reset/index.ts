const headers={
  'Content-Type':'text/plain; charset=utf-8',
  'Cache-Control':'no-store, max-age=0',
  'Pragma':'no-cache',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff'
};

Deno.serve(()=>new Response(
  'Este mecanismo temporal fue retirado. Usá el flujo normal de recuperación de acceso AVH.',
  {status:410,headers}
));
