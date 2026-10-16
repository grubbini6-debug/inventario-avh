// One palette for the quote preview and PDF. Logos remain unmodified.
(function(root){
 const normalize=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():null;
 const channels=value=>[1,3,5].map(n=>parseInt(value.slice(n,n+2),16));
 const hex=values=>'#'+values.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
 const luminance=value=>channels(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const mix=(a,b,part)=>hex(channels(a).map((v,i)=>v*(1-part)+channels(b)[i]*part));
 const fallback=company=>company?.brand_avh===false?'#334155':'#12522e';
 function colors(value){
  const primary=normalize(value)||'#334155';let heading=primary;
  for(let n=1;contrast(heading,'#ffffff')<4.5&&n<=25;n++)heading=mix(primary,'#000000',n/25);
  return{primary,heading,headerText:contrast(primary,'#ffffff')>=contrast(primary,'#000000')?'#ffffff':'#000000',pale:mix(primary,'#ffffff',.94),line:mix(primary,'#ffffff',.75)};
 }
 function fromPixels(rgba){
  const colorful=new Map(),neutral=new Map();let opaque=0,colored=0;
  for(let i=0;i+3<rgba.length;i+=4){
   const alpha=rgba[i+3]/255;if(alpha<.5)continue;opaque++;
   const rgb=[0,1,2].map(n=>Math.round(rgba[i+n]*alpha+255*(1-alpha))),max=Math.max(...rgb),min=Math.min(...rgb),chroma=max-min;
   if(min>245||min>225&&chroma<18)continue; // Ignore white paper and transparent margins.
   const saturated=chroma>=24&&chroma/Math.max(max,1)>=.18,buckets=saturated?colorful:neutral,key=rgb.map(v=>v>>5).join(',');
   const bucket=buckets.get(key)||{weight:0,sum:[0,0,0]},weight=alpha*(saturated?.5+chroma/Math.max(max,1):1);
   bucket.weight+=weight;rgb.forEach((v,n)=>bucket.sum[n]+=v*weight);buckets.set(key,bucket);if(saturated)colored++;
  }
  const buckets=colored>=Math.max(3,opaque*.005)?colorful:neutral;
  const best=[...buckets.values()].sort((a,b)=>b.weight-a.weight)[0];return best?hex(best.sum.map(v=>v/best.weight)):null;
 }
 async function detect(url){
  root.AVHCompanyLogo.read(url);
  const image=new Image();image.src=url;await image.decode();
  const scale=Math.min(1,128/image.naturalWidth,128/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('No se pudo leer el color del logo.');context.drawImage(image,0,0,canvas.width,canvas.height);return fromPixels(context.getImageData(0,0,canvas.width,canvas.height).data);
 }
 root.AVHQuoteTheme={normalize,fallback,colors,fromPixels,detect,contrast};
})(globalThis);
