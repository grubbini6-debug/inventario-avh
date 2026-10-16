// Exact pixel crops and one palette for the quote preview and PDF. Never redraw a logo.
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
 function analyze(rgba,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>2048||height>2048||width*height>2097152||rgba.length!==width*height*4)throw Error('Dimensiones del logo inválidas.');
  const rows=[];let total=0;
  for(let y=0;y<height;y++){let count=0,left=width,right=-1;for(let x=0;x<width;x++){const i=(y*width+x)*4,a=rgba[i+3]/255;if(a<.2)continue;const min=Math.min(rgba[i],rgba[i+1],rgba[i+2])*a+255*(1-a);if(min>=225)continue;count++;left=Math.min(left,x);right=Math.max(right,x);}rows.push({count,left,right});total+=count;}
  if(!total)return{bounds:{x:0,y:0,width,height},color:fromPixels(rgba),removedRules:0};
  // Detached, nearly solid strips at an edge are usually table headers, not the logo.
  const bands=[],gap=Math.max(2,Math.round(height*.035));let band;
  for(let y=0;y<height;y++){if(!rows[y].count)continue;if(!band||y-band.bottom>gap){band={top:y,bottom:y,left:width,right:0,count:0};bands.push(band);}band.bottom=y;band.left=Math.min(band.left,rows[y].left);band.right=Math.max(band.right,rows[y].right);band.count+=rows[y].count;}
  const rule=b=>{const w=b.right-b.left+1,h=b.bottom-b.top+1;return w>width*.75&&w/h>8&&b.count/(w*h)>.55&&h<height*.22&&(b.top<height*.08||b.bottom>height*.85);};
  // A cropped table can include the header AND several rows. It is not a thin strip:
  // require both repeated full-width rules and persistent vertical grid lines below a
  // separate logo, so a wordmark or a solid brand banner is never discarded on density alone.
  const table=b=>{
   const w=b.right-b.left+1,h=b.bottom-b.top+1;if(bands.length<2||b!==bands.at(-1)||b.top<height*.25||w<width*.8||h>height*.7)return false;
   let horizontal=0,last=-2;for(let y=b.top;y<=b.bottom;y++)if(rows[y].count>w*.88){if(y>last+1)horizontal++;last=y;}if(horizontal<3)return false;
   let vertical=0,previous=-2;for(let x=b.left;x<=b.right;x++){let count=0;for(let y=b.top;y<=b.bottom;y++){const i=(y*width+x)*4,a=rgba[i+3]/255;if(a>=.2&&Math.min(rgba[i],rgba[i+1],rgba[i+2])*a+255*(1-a)<225)count++;}if(count>h*.65){if(x>previous+1)vertical++;previous=x;}}
   return vertical>=3;
  };
  const tables=new Set(bands.filter(table));let kept=bands.filter(b=>!rule(b)&&!tables.has(b));if(!kept.length||kept.reduce((s,b)=>s+b.count,0)<(tables.size?30:total*.15))kept=bands;
  const pad=Math.max(2,Math.round(Math.max(width,height)*.012)),x=Math.max(0,Math.min(...kept.map(b=>b.left))-pad),y=Math.max(0,kept[0].top-pad),right=Math.min(width,Math.max(...kept.map(b=>b.right))+1+pad),bottom=Math.min(height,kept.at(-1).bottom+1+pad),bounds={x,y,width:right-x,height:bottom-y};
  const step=Math.max(1,Math.ceil(Math.sqrt(bounds.width*bounds.height/16384))),sample=[];
  for(let sy=y;sy<bottom;sy+=step)for(let sx=x;sx<right;sx+=step){const i=(sy*width+sx)*4;sample.push(rgba[i],rgba[i+1],rgba[i+2],rgba[i+3]);}
  return{bounds,color:fromPixels(sample),removedRules:bands.length-kept.length,removedTables:[...tables].filter(b=>!kept.includes(b)).length};
 }
 async function raster(url){
  root.AVHCompanyLogo.read(url);
  const image=new Image();image.src=url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('No se pudo leer el color del logo.');context.drawImage(image,0,0);return{canvas,analysis:analyze(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)};
 }
 async function detect(url){return(await raster(url)).analysis.color;}
 async function prepare(url){
  const{canvas,analysis}=await raster(url),b=analysis.bounds;if(b.x===0&&b.y===0&&b.width===canvas.width&&b.height===canvas.height)return{...analysis,data_url:url};
  const out=document.createElement('canvas');out.width=b.width;out.height=b.height;out.getContext('2d').drawImage(canvas,b.x,b.y,b.width,b.height,0,0,b.width,b.height);const data_url=out.toDataURL('image/png');
  try{root.AVHCompanyLogo.read(data_url);return{...analysis,data_url};}catch{return{...analysis,data_url:url};}
 }
 root.AVHQuoteTheme={normalize,fallback,colors,fromPixels,analyze,detect,prepare,contrast};
})(globalThis);
