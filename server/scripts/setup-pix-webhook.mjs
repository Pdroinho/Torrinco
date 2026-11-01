const key=process.env.ABACATEPAY_API_KEY;
const secret=process.env.ABACATEPAY_WEBHOOK_SECRET;
const apiUrl=process.env.PUBLIC_API_URL;
if(!key||!secret||secret.length<32||!apiUrl?.startsWith('https://')) throw new Error('Missing Pix webhook configuration');
const endpoint=`${apiUrl.replace(/\/$/,'')}/api/billing/webhook/abacatepay`;
async function call(path, method='GET', body) {
  const response=await fetch(`https://api.abacatepay.com/v2${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15_000)});
  const result=await response.json();
  if(!response.ok||!result.success)throw new Error(`${path}: HTTP ${response.status}`);
  return result;
}
const list=await call('/webhooks/list?limit=100');
if(!Array.isArray(list.data)||list.pagination?.hasMore)throw new Error('Webhook pagination requires inspection');
const existing=list.data.find(item=>item.endpoint===endpoint&&item.events?.includes('checkout.completed'));
if(existing)console.log(`Pix webhook already exists: ${existing.id}; verify its secret matches the server`);
else if(process.argv.includes('--create')) {
  const created=await call('/webhooks/create','POST',{name:'Torrinco Pix manual',endpoint,secret,events:['checkout.completed']});
  console.log(`Pix webhook created: ${created.data.id}`);
} else console.log('Pix webhook missing; rerun with --create after deploying the API');
