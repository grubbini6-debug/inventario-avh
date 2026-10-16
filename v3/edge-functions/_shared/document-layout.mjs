import {embedAvhLogo,drawAvhLogo} from './avh-brand.mjs';
import './company-logo.js';
export const cleanText=v=>String(v??'').replace(/[\u0000-\u0008\u000b-\u001f]/g,' ').replace(/[–—‑]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\u000a\u0020-\u00ff]/g,'?');
export function wrapText(value,font,size,width){
 const result=[];
 for(const paragraph of cleanText(value).split('\n')){let line='';
  for(let word of paragraph.split(/\s+/).filter(Boolean)){
   if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){result.push(line);line='';}
   while(word&&font.widthOfTextAtSize(word,size)>width){let n=1;while(n<word.length&&font.widthOfTextAtSize(word.slice(0,n+1),size)<=width)n++;result.push(word.slice(0,n));word=word.slice(n);}
   if(word)line=line?line+' '+word:word;
  }result.push(line);
 }return result.length?result:[''];
}
export async function documentLayout(lib,{company={},title,number,date='',status='',reference='',institutionalLogo=true,theme=null,professional=false,fontProvider=null}){
 const {PDFDocument,StandardFonts,rgb}=lib,pdf=await PDFDocument.create(),fonts=fontProvider?await fontProvider(pdf):{regular:await pdf.embedFont(StandardFonts.Helvetica),bold:await pdf.embedFont(StandardFonts.HelveticaBold)}, {regular,bold}=fonts,custom=company.brand_avh===false&&company.logo_data_url?globalThis.AVHCompanyLogo.read(company.logo_data_url):null;
 const logo=custom?await (custom.mime==='image/png'?pdf.embedPng(custom.bytes):pdf.embedJpg(custom.bytes)):institutionalLogo&&company.brand_avh!==false?await embedAvhLogo(pdf):null;
 const companyName=company.legal_name||company.name||(company.brand_avh===false?'Empresa emisora por completar':'Astillero Villa Hayes S.A.');
 const color={green:rgb(.07,.32,.18),ink:rgb(.14,.19,.16),muted:rgb(.4,.47,.43),line:rgb(.82,.87,.83),pale:rgb(.95,.975,.96),white:rgb(1,1,1),warn:rgb(.66,.24,.12)};
 color.header=color.green;color.headerText=color.white;color.accent=color.green;
 if(theme){const asRgb=hex=>rgb(...[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)/255));Object.assign(color,{green:asRgb(theme.heading),header:asRgb(theme.primary),headerText:asRgb(theme.headerText),accent:asRgb(theme.primary),pale:asRgb(theme.pale),line:asRgb(theme.line),ink:rgb(.12,.15,.18),muted:rgb(.34,.38,.42)});}
 const left=36,width=523,bottom=64;let page,y;
 function text(value,x,yy,size=9,font=regular,ink=color.ink){page.drawText(cleanText(value).replace(/\n/g,' '),{x,y:yy,size,font,color:ink});}
 function fixed(value,x,top,w,size,font=regular,ink=color.ink){const lines=wrapText(value,font,size,w);lines.forEach((line,i)=>text(line,x,top-i*(size+3),size,font,ink));return top-lines.length*(size+3);}
 function quoteHeader(first){
  const top=805;let a=top,b;
  if(logo){const maxW=first?192:96,maxH=first?64:28;if(custom){const scale=Math.min(maxW/logo.width,maxH/logo.height),h=logo.height*scale;page.drawImage(logo,{x:left,y:top-h,width:logo.width*scale,height:h});a=top-h-15;}else{drawAvhLogo(page,logo,lib,left,top-maxH,maxH);a=top-maxH-15;}}
  a=fixed(companyName,left,a,310,first?10.5:9,bold);
  if(first)for(const detail of [company.tax_id?'RUC '+company.tax_id:'',company.address,[company.phone,company.email].filter(Boolean).join(' | ')].filter(Boolean))a=fixed(detail,left,a-2,310,8,regular,color.muted);
  else if(reference)a=fixed(reference,left,a-1,310,8,regular,color.muted);
  b=fixed(title,367,800,192,first?19:13,bold,color.green);b=fixed(number,367,b-7,192,9.5,bold);
  if(first&&date)b=fixed('Fecha: '+date,367,b-5,192,8.5,regular,color.muted);
  if(status)b=fixed(status,367,b-7,192,7.5,bold,color.warn);
  y=Math.min(a,b)-12;page.drawLine({start:{x:left,y},end:{x:559,y},color:color.accent,thickness:1.4});y-=25;
 }
 function add(){
  page=pdf.addPage([595.28,841.89]);const first=pdf.getPageCount()===1;if(professional){quoteHeader(first);return;}if(logo){const box=first?65:39,yy=first?747:773;if(custom){const factor=Math.min(box/logo.width,box/logo.height);page.drawImage(logo,{x:36+(box-logo.width*factor)/2,y:yy+(box-logo.height*factor)/2,width:logo.width*factor,height:logo.height*factor});}else drawAvhLogo(page,logo,lib,36,yy,box);}let a,b;const companyX=logo?114:36,companyW=logo?268:346;
  if(first){
   a=fixed(companyName,companyX,808,companyW,10,bold,color.green);
   for(const detail of [company.tax_id?'RUC '+company.tax_id:'',company.address,[company.phone,company.email].filter(Boolean).join(' | ')].filter(Boolean))a=fixed(detail,companyX,a-2,companyW,7.4,regular,color.muted);
   b=fixed(title,404,807,155,12,bold,color.green);b=fixed(number,404,b-5,155,9.2,bold,color.green);if(date)b=fixed('Fecha: '+date,404,b-3,155,8,regular,color.muted);
  }else{const x=logo?87:36;a=fixed(title,x,807,logo?300:351,10,bold,color.green);if(reference)a=fixed(reference,x,a-3,logo?300:351,8,regular,color.muted);b=fixed(number,404,807,155,9,bold,color.green);}
  if(status)b=fixed(status,404,b-5,155,8,bold,color.warn);
  y=Math.min(a,b,first?747:774)-12;page.drawLine({start:{x:left,y},end:{x:559,y},color:color.accent,thickness:1.2});y-=23;
 }
 function ensure(height){if(y-height<bottom)add();}
 function paragraph(value,{size=9,font=regular,ink=color.ink,after=8}={}){for(const line of wrapText(value,font,size,width)){ensure(size+5);text(line,left,y,size,font,ink);y-=size+4;}y-=after;}
 function heading(value,{size=professional?11.5:11}={}){const lines=wrapText(value,bold,size,width);ensure(Math.min(lines.length*(size+4)+44,580));y-=4;for(const line of lines){ensure(size+7);text(line,left,y,size,bold,color.green);y-=size+4;}y-=7;}
 function table(headers,widths,rows,{size=8.5,lineHeight=11,rowPadding=10,align=[],tone='brand',emphasizeLast=false}={}){
  const xs=[];let x=left;for(const w of widths){xs.push(x);x+=w;}if(Math.abs(widths.reduce((a,b)=>a+b,0)-width)>.1)throw Error('Ancho de tabla inválido');
  const cellsH=headers.map((h,i)=>wrapText(h,bold,8,widths[i]-12)),hh=Math.max(...cellsH.map(c=>c.length))*10+12;
  function header(){ensure(hh+30);page.drawRectangle({x:left,y:y-hh,width,height:hh,color:tone==='quiet'?color.pale:color.header});cellsH.forEach((c,i)=>c.forEach((s,j)=>text(s,xs[i]+6,y-14-j*10,8,bold,tone==='quiet'?color.green:color.headerText)));y-=hh;}
  header();rows.forEach((row,index)=>{
   const strong=emphasizeLast&&index===rows.length-1,font=strong?bold:regular,cells=row.map((v,i)=>wrapText(v,font,size,widths[i]-12));let remaining=Math.max(...cells.map(c=>c.length)),offset=0;const h=remaining*lineHeight+rowPadding;
   if(y-h<bottom&&h<600){add();header();}
   while(remaining>0){
    if(y-lineHeight-rowPadding<bottom){add();header();}const count=Math.min(remaining,Math.max(1,Math.floor((y-bottom-rowPadding)/lineHeight))),height=count*lineHeight+rowPadding;
    if((index%2===0||strong)&&tone!=='quiet')page.drawRectangle({x:left,y:y-height,width,height,color:color.pale});
    if(strong&&offset===0)page.drawLine({start:{x:left,y},end:{x:559,y},color:color.accent,thickness:.8});
    cells.forEach((lines,i)=>lines.slice(offset,offset+count).forEach((s,j)=>text(s,align[i]==='right'?xs[i]+widths[i]-6-font.widthOfTextAtSize(s,size):xs[i]+6,y-13-j*lineHeight,size,font)));
    page.drawLine({start:{x:left,y:y-height},end:{x:559,y:y-height},color:color.line,thickness:.45});y-=height;remaining-=count;offset+=count;if(remaining>0){add();header();}
   }
  });y-=12;
 }
 function signatures(labels,names=[]){
  const col=(width-24*(labels.length-1))/labels.length,all=names.map(n=>wrapText(n,regular,8,col)),h=72+Math.max(0,...all.map(l=>l.length-1))*11;ensure(h);y-=8;
  labels.forEach((label,i)=>{const x=left+i*(col+24);page.drawLine({start:{x,y:y-26},end:{x:x+col,y:y-26},color:color.muted,thickness:.6});text(label,x,y-40,8.5,bold);(all[i]||[]).forEach((s,j)=>text(s,x,y-54-j*11,8));});y-=h;
 }
 async function save(){
  pdf.getPages().forEach((pg,i)=>{pg.drawLine({start:{x:left,y:43},end:{x:559,y:43},color:color.line,thickness:.6});pg.drawText(cleanText(number),{x:left,y:29,font:regular,size:7.5,color:color.muted});const label='Página '+(i+1)+' de '+pdf.getPageCount();pg.drawText(label,{x:559-regular.widthOfTextAtSize(label,8),y:29,font:regular,size:8,color:color.muted});});
  pdf.setTitle(cleanText(number+' - '+reference));pdf.setAuthor(cleanText(companyName));return pdf.save();
 }
 add();return{pdf,regular,bold,color,text,paragraph,heading,table,signatures,save,ensure,get page(){return page;},get y(){return y;},set y(v){y=v;}};
}
