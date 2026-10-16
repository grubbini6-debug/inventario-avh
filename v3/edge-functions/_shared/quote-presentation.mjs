// Present imported specifications without OCR commentary or duplicated price columns.
// Stored scope and financial values remain untouched; only known import labels are formatted.
export function quoteUnit(value,quantity){const unit=String(value||'').trim();if(quantity!=null&&/^(?:units?|unidad(?:es)?)$/i.test(unit))return Number(quantity)===1?'unidad':'unidades';return({unit:'unidad',units:'unidades',kg:'kg',m2:'m²',m3:'m³'})[unit.toLowerCase()]||unit;}
export function quoteDescription(value){
 const text=String(value??''),marker=text.match(/\s+-\s+(?=(?:Length\b|Width\b|Thk\b|M2\b|Total Weight\b|Quantity\b|Tarea\/Actividad\b))/i);if(!marker)return text;
 const main=text.slice(0,marker.index).trim(),raw=text.slice(marker.index+marker[0].length),parts=raw.split(/;|\s+-\s+(?=Cantidad f[ií]sica:)/i),details=[];let quantity='',physical='';
 for(let part of parts){
  part=part.trim().replace(/[.;]+$/,'').trim();if(!part||/^total visible in (?:the )?table$/i.test(part)||/^Tarea\/Actividad$/i.test(part))continue;
  if(/^Unit\.?\s*Price\s*:?[\s\d.,]+(?:USD|PYG|Gs\.?)?$/i.test(part))continue;
  let m=part.match(/^Quantity\s*:?\s*(.+)$/i);if(m){quantity=m[1];continue;}m=part.match(/^Cantidad f[ií]sica:\s*(.+)$/i);if(m){physical=m[1].replace(/\bunits?\b/gi,s=>quoteUnit(s,m[1].split(/\s/)[0])).replace(/\bm2\b/gi,'m²').replace(/\bm3\b/gi,'m³');continue;}
  const labels=[[/^Length\s*:?\s*/i,'Largo: '],[/^Width\s*:?\s*/i,'Ancho: '],[/^Thk\s*:?\s*/i,'Espesor: '],[/^Total Weight\s*:?\s*/i,'Peso: '],[/^(?:M2|Area)\s*:?\s*/i,'Superficie: ']];let surface=false;
  for(const [pattern,label] of labels)if(pattern.test(part)){surface=label==='Superficie: ';part=part.replace(pattern,label);break;}
  part=part.replace(/\bKg\b/g,'kg');if(surface&&!/m[²2]$/i.test(part))part+=' m²';details.push(part);
 }
 if(quantity&&(!physical||physical.split(/\s/)[0]!==quantity))details.push('Cantidad indicada: '+quantity);
 if(physical)details.push('Cantidad física: '+physical);
 return[main,[...new Set(details)].join(' · ')].filter(Boolean).join('\n');
}
