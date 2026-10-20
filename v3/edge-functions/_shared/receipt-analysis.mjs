export function validateReceiptAnalysis(analysis,purchases) {
 const warnings=[],items=Array.isArray(analysis.detected_items)?analysis.detected_items:[];
 let selected=purchases.find(p=>p.purchase_id===analysis.matched_purchase_id);
 if(!selected||analysis.confidence<.85){selected=null;analysis.matched_purchase_id=null;analysis.matched_po_number=null;analysis.matched_supplier_name=null;warnings.push('No se identificó una OC con suficiente seguridad. Elegila manualmente.');}
 else {analysis.matched_po_number=selected.po_number;analysis.matched_supplier_name=selected.supplier;}
 const count=new Map();for(const it of items)if(it.purchase_item_id)count.set(it.purchase_item_id,(count.get(it.purchase_item_id)||0)+1);
 for(const it of items){
  const src=selected?.items.find(x=>x.purchase_item_id===it.purchase_item_id);
  if(!src){it.purchase_item_id=null;it.product_id=null;it.quantity=null;continue;}
  it.product_id=src.product_id;
  const issues=globalThis.AVHProductIdentity.conflicts(it,{description:src.description,brand:src.brand,manufacturer_code:src.manufacturer_code});
  if(issues.length){warnings.push(...issues);it.purchase_item_id=null;it.product_id=null;it.quantity=null;continue;}
  const from=globalThis.AVHReceiving.unit(it.unit),to=globalThis.AVHReceiving.unit(src.unit);
  if(it.confidence<.9||count.get(it.purchase_item_id)>1||typeof it.quantity!=='number'||it.quantity<=0||!from||from!==to||it.quantity>src.pending){warnings.push('Revisá cantidad y unidad de '+src.description+' contra el original y la OC.');it.quantity=null;}
 }
 if(analysis.document_date){const d=analysis.document_date;if(!/^\d{4}-\d\d-\d\d$/.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d){analysis.document_date=null;warnings.push('La fecha no se identificó con seguridad. Completala manualmente.');}}
 analysis.warnings=[...new Set(warnings)];return analysis;
}
