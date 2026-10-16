import {deflateSync} from 'node:zlib';
function chunk(type,bytes){
 const body=Buffer.concat([Buffer.from(type),bytes]);let crc=0xffffffff;
 for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
 const size=Buffer.alloc(4),tail=Buffer.alloc(4);size.writeUInt32BE(bytes.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,tail]);
}
export function logoDataUrl(width=192,height=64){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const pos=y*(width*3+1)+1+x*3;rows[pos]=x<width/4?240:24;rows[pos+1]=x<width/4?154:66;rows[pos+2]=x<width/4?40:128;}
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
export function workbookWithLogos(X,bytes,entries){
 const zip=X.CFB.read(new Uint8Array(bytes),{type:'array'}),add=(path,data)=>X.CFB.utils.cfb_add(zip,path,typeof data==='string'?Buffer.from(data):data),read=path=>Buffer.from(zip.FileIndex[zip.FullPaths.findIndex(p=>p===path||p.endsWith('/'+path))].content).toString();
 const sheetGroups=new Map();for(const entry of entries){if(!sheetGroups.has(entry.sheet))sheetGroups.set(entry.sheet,[]);sheetGroups.get(entry.sheet).push(entry);}
 for(const [sheet,images] of sheetGroups){
  const name='sheet'+sheet,draw='drawing'+sheet;add('xl/worksheets/'+name+'.xml',read('xl/worksheets/'+name+'.xml').replace('</worksheet>','<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdLogo"/></worksheet>'));
  add('xl/worksheets/_rels/'+name+'.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/'+draw+'.xml"/></Relationships>');
  add('xl/drawings/'+draw+'.xml','<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+images.map((_,i)=>'<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1828800" cy="609600"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+(i+1)+'" name="Logo '+(i+1)+'"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId'+i+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>').join('')+'</xdr:wsDr>');
  add('xl/drawings/_rels/'+draw+'.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+images.map((image,i)=>'<Relationship Id="rId'+i+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/'+image.name+'"/>').join('')+'</Relationships>');
  for(const image of images)add('xl/media/'+image.name,Buffer.from(image.data_url.split(',')[1],'base64'));
 }
 add('[Content_Types].xml',read('[Content_Types].xml').replace('</Types>','<Default Extension="png" ContentType="image/png"/>'+[...sheetGroups.keys()].map(sheet=>'<Override PartName="/xl/drawings/drawing'+sheet+'.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>').join('')+'</Types>'));
 return X.CFB.write(zip,{type:'array',fileType:'zip'});
}
