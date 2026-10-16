import {documentLayout} from './document-layout.mjs';
import './quote-theme.js';
import {quoteBranding,quoteFonts} from './quote-branding.mjs';
export const money=(value,currency)=>value==null?'Por definir':Number(value).toLocaleString('es-PY',{minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:currency==='USD'?2:0});
export async function makeCommercialPdf(order,lib){
 const p=order.issued_payload||order.payload,quote=order.kind==='quote',number=order.number||'BORRADOR - SIN EMITIR',cancelled=order.status==='cancelled'||order.purchase_status==='cancelled';
 const branding=quote?quoteBranding(p.company||order.company||{}):{company:p.company||order.company||{},theme:null}, {company,theme}=branding,doc=await documentLayout(lib,{company,theme,professional:quote,fontProvider:quote?quoteFonts:null,institutionalLogo:company.brand_avh!==false,title:quote?'PRESUPUESTO':'ORDEN DE COMPRA',number,date:p.document_date,reference:p.reference||p.title,status:cancelled?'DOCUMENTO ANULADO':!order.number?(order.status==='submitted'?'PENDIENTE DE AUTORIZACIÓN':'BORRADOR PARA REVISIÓN'):''});
 doc.heading(p.title,quote?{size:14}:{});
 doc.table([quote?'Cliente':'Proveedor','Referencia y entrega'],[261,262],[
  [p.recipient_name||'Por definir',p.reference||'Sin referencia'],
  [p.recipient_tax_id?'RUC / identificación: '+p.recipient_tax_id:'Identificación: por definir','Lugar: '+(p.location||'Por definir')],
  [[p.recipient_address,p.recipient_contact].filter(Boolean).join('\n'),quote?'Vigencia hasta: '+(p.valid_until||'Por definir'):'Entrega prevista: '+(p.delivery_date||'A coordinar')]
 ],quote?{tone:'quiet',size:9,lineHeight:12,rowPadding:11}:{});
 if(p.introduction)doc.paragraph(p.introduction);
 doc.heading(quote?'Detalle del presupuesto':'Bienes y servicios solicitados');
 const currency=p.currency||'PYG',items=p.items||[],pending=items.some(i=>i.quantity==null||i.unit_price==null);
 doc.table(['Ítem','Descripción','Cantidad / unidad','Precio unit. '+currency,'Importe '+currency],quote?[31,268,64,80,80]:[31,231,77,92,92],items.map((i,n)=>[n+1,i.description,i.quantity==null?'Por definir':Number(i.quantity).toLocaleString('es-PY',{maximumFractionDigits:6})+' '+i.unit,i.unit_price==null?'Por definir':Number(i.unit_price).toLocaleString('es-PY',{minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:6}),money(i.amount,currency)]),{size:quote?9:8,lineHeight:quote?12.5:11,rowPadding:quote?8:10,align:['','','right','right','right']});
 if(pending)doc.paragraph('Importes pendientes de completar. El borrador no tiene un total definitivo.',{ink:doc.color.warn});
 else{
  doc.ensure(110);const rows=[['Subtotal',money(p.subtotal,currency)]];
  if(Number(p.rounding_adjustment))rows.push(['Ajuste de redondeo',money(p.rounding_adjustment,currency)]);
  if(p.tax_mode==='add')rows.push(['IVA '+p.tax_rate+'%',money(p.tax_amount,currency)]);
  if(p.tax_mode==='included')rows.push(['IVA '+p.tax_rate+'% incluido',money(p.tax_amount,currency)]);
  if(p.tax_mode==='none')rows.push(['Tratamiento de impuestos','Sin IVA']);
  doc.table(['Concepto','Importe / moneda'],[353,170],rows.concat([['TOTAL '+currency,money(p.total,currency)]]),{align:['','right'],size:9});
 }
 if(quote)doc.ensure(190);
 doc.heading('Condiciones comerciales');doc.paragraph('Pago: '+(p.payment_terms||'Por definir'));doc.paragraph('Entrega / ejecución: '+(p.delivery_terms||'Por definir'));
 if(p.notes){doc.heading('Observaciones');doc.paragraph(p.notes);}
 doc.signatures(quote?['Preparado por','Aceptación del cliente']:['Preparado por','Autorización de Compras'],[p.issuer_name||'']);return doc.save();
}
