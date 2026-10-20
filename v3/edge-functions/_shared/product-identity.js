// Technical identity is separate from supplier, purchase price and packaging conversion.
(function(root){
 const brands=['maxflexx','norton','tyrolit','wst','esab','hyundai','lincoln','thor','atlantic','conarco','bosch','makita','dewalt','stanley','3m','gastec','elcometer','graco','sata','weg','tramontina','starrett','bahco','irwin','miller','kemppi','fronius'];
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/½/g,' 1/2').replace(/¼/g,' 1/4').replace(/¾/g,' 3/4').replace(/(\d+)[.\s-]+([123])\s*\/\s*([24])/g,(_,a,b,c)=>String(Number(a)+Number(b)/Number(c))).replace(/(\d),(?=\d)/g,'$1.').replace(/[″“”]/g,'"').trim();
 const key=v=>norm(v).replace(/[^a-z0-9]/g,'');
 function identity(item,catalog=[]){
  const text=norm(item?.description||item?.name),known=[...new Set([...brands,...catalog.map(x=>norm(x.brand)).filter(Boolean)])];
  const brand=norm(item?.brand)||known.find(b=>new RegExp('(^|[^a-z0-9])'+b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)').test(text))||text.match(/\bmarca\s+([a-z][a-z0-9-]+)/)?.[1]||null;
  const sizes={mm:[],inch:[],kg:[]};
  for(const m of text.matchAll(/(\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)*)\s*(mm\b|pulgadas?\b|pulg\b|inch\b|"|kg\b)/g)){
   const unit=m[2]==='mm'?'mm':m[2]==='kg'?'kg':'inch';sizes[unit].push(...m[1].split(/[x×]/).map(Number));
  }
  for(const u of Object.keys(sizes))sizes[u]=[...new Set(sizes[u])].sort((a,b)=>a-b);
  const family=/\bdisco\b/.test(text)?/\bdesbaste\b/.test(text)?'disco-desbaste':/\bcorte\b/.test(text)?'disco-corte':null:null;
  const classification=text.replace(/[^a-z0-9]/g,'').match(/e71t1c?|er70s6|em12k/)?.[0]||null;
  return{brand,model:key(item?.manufacturer_code||item?.model||text.match(/\b(mca[-\s]*\d+[a-z0-9-]*)\b/)?.[1])||null,family,classification,sizes};
 }
 function conflicts(a,b,catalog=[]){
  const x=identity(a,catalog),y=identity(b,catalog),issues=[];
  if(x.brand&&y.brand&&key(x.brand)!==key(y.brand))issues.push('La marca no coincide con el producto seleccionado.');
  if(x.model&&y.model&&x.model!==y.model)issues.push('El modelo o código de fabricante no coincide.');
  if(x.family&&y.family&&x.family!==y.family)issues.push('Corte y desbaste son productos distintos.');
  if(x.classification&&y.classification&&x.classification!==y.classification)issues.push('La clasificación técnica no coincide.');
  for(const u of ['mm','inch','kg'])if(x.sizes[u].length&&y.sizes[u].length&&!x.sizes[u].every(v=>y.sizes[u].some(w=>Math.abs(v-w)<.000001))&&!y.sizes[u].every(v=>x.sizes[u].some(w=>Math.abs(v-w)<.000001)))issues.push('La medida o presentación en '+({mm:'mm',inch:'pulgadas',kg:'kg'}[u])+' no coincide.');
  return issues;
 }
 function automatic(a,b,catalog=[]){
  if(conflicts(a,b,catalog).length)return false;
  const x=identity(a,catalog),y=identity(b,catalog);
  // A generic catalog name cannot establish the brand of the delivered material.
  if(x.brand&&!y.brand||!x.brand&&y.brand)return false;
  for(const u of ['mm','inch','kg'])if(x.sizes[u].length&&y.sizes[u].length&&x.sizes[u].join('|')!==y.sizes[u].join('|'))return false;
  return true;
 }
 root.AVHProductIdentity=Object.freeze({identity,conflicts,automatic,key});
})(globalThis);
