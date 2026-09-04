// AVH V3 — Estado compartido en memoria.
let session=null;
let profile=null;
let refreshTimer=null;
let loading=false;
let activeModule='';
let activeAdminTab='users';
const D={warehouses:[],products:[],presentations:[],contractors:[],barges:[],suppliers:[],stocks:[],stockStatus:[],stockValues:[],minimums:[],moves:[],bargeConsumption:[],contractorConsumption:[],productConsumption:[],warehouseActivity:[],productRequests:[],correctionRequests:[],notifications:[],profiles:[],openingInventorySessions:[]};
