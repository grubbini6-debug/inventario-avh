import UPNGModule from '@pdf-lib/upng';
import jpeg from 'jpeg-js';
import fontkit from '@pdf-lib/fontkit';
import {regular,bold} from './quote-font-data.mjs';
import './company-logo.js';
import './quote-theme.js';
const UPNG=UPNGModule.default||UPNGModule,bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
// document-layout cleans all PDF strings to Latin-1. Complex-script shaping for every
// width measurement is unnecessary here and exceeds the Edge CPU budget on long quotes.
// Keep the embedded Inter outlines and Unicode maps; use the same glyph advances for
// measuring and encoding, with a per-font character cache and no optional ligatures.
const latinFontkit={create(data){
 const font=fontkit.create(data),glyphs=new Map();
 font.layout=value=>({glyphs:Array.from(value,char=>{const code=char.codePointAt(0);if(!glyphs.has(code))glyphs.set(code,font.glyphForCodePoint(code));return glyphs.get(code);})});
 return font;
}};
export async function quoteFonts(pdf){pdf.registerFontkit(latinFontkit);return{regular:await pdf.embedFont(bytes(regular),{subset:true}),bold:await pdf.embedFont(bytes(bold),{subset:true})};}
export function quoteBranding(company){
 const T=globalThis.AVHQuoteTheme,L=globalThis.AVHCompanyLogo,c={...company};let detected=null;
 if(c.brand_avh===false&&c.logo_data_url){
  const logo=L.read(c.logo_data_url);let rgba;
  if(logo.mime==='image/png'){const png=UPNG.decode(logo.bytes.buffer);if(png.width!==logo.width||png.height!==logo.height)throw Error('Logo PNG inválido.');rgba=new Uint8Array(UPNG.toRGBA8(png)[0]);}
  else rgba=jpeg.decode(logo.bytes,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:2.1,maxMemoryUsageInMB:64}).data;
  const analysis=T.analyze(rgba,logo.width,logo.height),b=analysis.bounds;detected=analysis.color;
  if(b.x||b.y||b.width!==logo.width||b.height!==logo.height){
   const crop=new Uint8Array(b.width*b.height*4);for(let y=0;y<b.height;y++){const offset=((y+b.y)*logo.width+b.x)*4;crop.set(rgba.subarray(offset,offset+b.width*4),y*b.width*4);}
   const encoded=new Uint8Array(UPNG.encode([crop.buffer],b.width,b.height,0));if(encoded.length<=300*1024)c.logo_data_url=L.encode(encoded,'image/png');
  }
  // Repair old automatic palettes taken from an accidental table strip, while retaining manual choices.
  if(c.brand_color_mode!=='manual'&&(!T.normalize(c.brand_color)||analysis.removedRules>0)&&detected)c.brand_color=detected;
 }
 return{company:c,theme:T.colors(T.normalize(c.brand_color)||detected||T.fallback(c))};
}
