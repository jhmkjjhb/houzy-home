// The private project token is a bearer capability returned by the registered-phone
// lookup (owner-approved: phone alone, no access code) or shared by staff. Never accept
// a caller-supplied path.
const origins = new Set(['https://houzyhome.com', 'https://www.houzyhome.com']);
Deno.serve(async (req: Request) => {
 const origin = req.headers.get('origin');
 const cors: Record<string,string> = {'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 if (origin && origins.has(origin)) cors['Access-Control-Allow-Origin']=origin;
 const reply=(status: number,data: unknown)=>new Response(JSON.stringify(data),{status,headers:cors});
 if (origin && !origins.has(origin)) return reply(403,{error:'不允许的访问来源'});
 if (req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if (req.method!=='POST') return reply(405,{error:'仅接受POST请求'});
 try {
  // Bound the decoded request, including chunked requests without Content-Length.
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:'缺少查询资料'});
  const chunks: Uint8Array[]=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1024){await reader.cancel();return reply(413,{error:'请求过大'});}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{error:'查询资料无效'});}
  const token=body?.token;
  if(typeof token!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))return reply(400,{error:'项目凭证无效'});
  const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||!key)return reply(503,{error:'合同服务暂不可用'});
  const headers={apikey:key,Authorization:`Bearer ${key}`};
  const query=new URL('/rest/v1/renovation_projects',base);query.searchParams.set('select','id,state,snapshot');query.searchParams.set('customer_token','eq.'+token);query.searchParams.set('state','neq.draft');query.searchParams.set('limit','1');
  const found=await fetch(query,{headers,signal:AbortSignal.timeout(10000)});
  if(!found.ok)return reply(503,{error:'合同服务暂不可用'});
  const rows=await found.json(),project=rows[0];
  if(!project)return reply(404,{error:'项目尚未确认或查阅凭证已失效'});
  const path=project.snapshot?.contract_path;
  if(typeof path!=='string'||!path.startsWith(project.id+'/')||path.split('/').length!==2||!path.endsWith('.pdf'))return reply(404,{error:'尚无可查看的归档合同'});
  const signed=await fetch(new URL('/storage/v1/object/sign/renovation-contracts/'+path.split('/').map(encodeURIComponent).join('/'),base),{
   method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120}),signal:AbortSignal.timeout(10000)
  });
  if(!signed.ok)return reply(503,{error:'暂时无法打开合同，请联系HOUZY'});
  const data=await signed.json();
  if(typeof data.signedURL!=='string'||!data.signedURL.startsWith('/object/sign/renovation-contracts/'))return reply(503,{error:'合同服务返回异常'});
  return reply(200,{url:base+'/storage/v1'+data.signedURL,expires_in:120});
 }catch{return reply(503,{error:'网络繁忙，请稍后重试'});}
});
