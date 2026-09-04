// AVH V3 — Estado compartido en memoria.
let session=null;
let profile=null;
let refreshTimer=null;
let loading=false;
let lastSyncAt=null;
let lastSyncErrors=[];
let activeModule='';
let activeAdminTab='users';
const D={warehouses:[],products:[],presentations:[],barges:[],suppliers:[],stocks:[],stockStatus:[],stockValues:[],minimums:[],moves:[],bargeConsumption:[],productConsumption:[],warehouseActivity:[],productRequests:[],correctionRequests:[],notifications:[],profiles:[],openingInventorySessions:[],auditEvents:[]};
