'use strict';
// Visible, LAN-only Windows PC Remote service. Runs only while user keeps the host console open.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const ROOT = __dirname;
const PRESETS = { low: [35, 0.40, 6], med: [50, 0.60, 10], high: [70, 0.85, 12] };
const commands = new Set(['shutdown','restart','logoff','sleep','lock','volup','voldown','mute','playpause','next','prev','cancel']);
const COOKIE_NAME = 'pc_remote_session';
const SESSION_TIME = 2 * 60 * 60 * 1000;
const MAX_PACKET = 8 * 1024 * 1024;
function addresses() {
  const a = [];
  for (const nics of Object.values(os.networkInterfaces())) for (const n of nics || [])
    if (n.family === 'IPv4' && !n.internal) a.push(n.address);
  return a;
}
function privateIP(ip) {
  ip = (ip || '').replace(/^::ffff:/, '');
  if (ip === '::1') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
function loopbackIP(ip) {
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
}
function tunnelHost(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value))
    throw new Error('tunnelHostname must be an exact DNS hostname, without scheme, port or path');
  return value.toLowerCase();
}
function sameHost(hostHeader, allowed) {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return allowed.has(host);
}
const respond = (res, status, payload, headers={}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(payload));
};
async function jsonBody(req, max=4096) {
  let size=0, parts=[];
  for await (const b of req) { size += b.length; if(size > max) throw new Error('Request too large'); parts.push(b); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { throw new Error('Invalid JSON'); }
}
function validInput(c) {
  if(typeof c !== 'string' || c.length > 90000) return false;
  const [verb, ...rest] = c.split(' '), v=rest.join(' ');
  if (['mv','abs'].includes(verb)) return /^-?\d{1,6} -?\d{1,6}$/.test(v);
  if (verb === 'wheel') return /^-?\d{1,5}$/.test(v);
  if (['click','down','up'].includes(verb)) return /^[lrm]$/.test(v);
  if (verb === 'dbl') return v === '';
  if (['key','keydown','keyup'].includes(verb)) return /^\d{1,3}$/.test(v) && Number(v)<=255;
  if (verb === 'combo') return /^\d{1,3}(,\d{1,3}){1,3}$/.test(v) && v.split(',').every(x => Number(x)<=255);
  if (verb === 'text' || verb === 'paste') {
    const limit = verb === 'paste' ? 65536 : 600;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v) || v.length % 4 !== 0 || v.length > Math.ceil(limit / 3) * 4) return false;
    const bytes=Buffer.from(v,'base64');
    if(bytes.length < 1 || bytes.length > limit || bytes.toString('base64') !== v) return false;
    try { new TextDecoder('utf-8',{fatal:true}).decode(bytes);return true; } catch { return false; }
  }
  return false;
}
function createApp(options={}) {
  const tunnelHostname = tunnelHost(options.tunnelHostname);
  const requirePin = options.requirePin ?? !!options.pin;
  const pin = options.pin || String(crypto.randomInt(10000000,99999999));
  const port = options.port ?? Number(process.env.PORT || 7666);
  const enabled = options.screen ?? true;
  const hostname = os.hostname();
  const interfaces = addresses();
  const hostnames = new Set(['localhost','127.0.0.1',hostname.toLowerCase(),...interfaces]);
  const sessions = new Map(), strikes = new Map(), activity=[];
  const viewers = new Set();
  const pendingInput = new Map();
  function failPending(message) {
    for(const item of pendingInput.values()){clearTimeout(item.timer);item.reject(new Error(message));}
    pendingInput.clear();
  }
  let agent=null, agentPreset=null, agentMeta=null, agentBuffer=Buffer.alloc(0), agentReady=false;
  const record=(ip,text)=>{activity.unshift({t:Date.now(),ip,text});activity.length=Math.min(20,activity.length);};
  const cookie=(req)=>{
    const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='));
    return raw?raw.slice(COOKIE_NAME.length+1):'';
  };
  const auth=(req)=>{
    const token=cookie(req), s=sessions.get(token);
    if(!s || s.ip!==req.socket.remoteAddress || s.until<Date.now()) {sessions.delete(token);return null;}
    return token;
  };
  const requiresHeader=(req)=>req.headers['x-pcr']==='1';
  function endAgent() {
    failPending('Desktop agent disconnected');
    const p=agent;agent=null;agentPreset=null;agentMeta=null;agentBuffer=Buffer.alloc(0);agentReady=false;
    if(p) { try {p.stdin.end();p.kill();}catch{} }
  }
  function endViewers() {
    for(const v of viewers) {try {v.res.end();} catch{}}
    viewers.clear();endAgent();
  }
  function startAgent(preset) {
    if (agent && agentPreset===preset) return true;
    endAgent();
    if ((process.platform!=='win32' && !options.agentFactory) || options.disableAgent) return false;
    const exe=path.join(ROOT,'RemoteAgent','bin','RemoteAgent.exe');
    const dll=path.join(ROOT,'RemoteAgent','bin','RemoteAgent.dll');
    if(!options.agentFactory && !fs.existsSync(exe) && !fs.existsSync(dll))return false;
    const [quality,scale,fps]=PRESETS[preset];
    let bin,args;
    if(fs.existsSync(exe)) {bin=exe;args=[String(fps),String(quality),String(scale)];}
    else {bin='dotnet';args=[dll,String(fps),String(quality),String(scale)];}
    const p=options.agentFactory ? options.agentFactory(preset) : spawn(bin,args,{cwd:ROOT,windowsHide:false,stdio:['pipe','pipe','pipe']});
    agent=p;agentPreset=preset;agentBuffer=Buffer.alloc(0);agentReady=false;
    p.stdin.on('error',()=>{});
    p.stderr.on('data',d=>console.error('[Desktop agent]',String(d).trim()));
    p.on('error',e=>{console.error('Desktop agent failed:',e.message);for(const v of viewers)try{v.res.end();}catch{};viewers.clear();endAgent();});
    p.stdout.on('data',data=>{
      if(agent!==p)return;
      agentBuffer=Buffer.concat([agentBuffer,data]);
      while(agentBuffer.length>=5){
        const len=agentBuffer.readUInt32BE(1);
        if(len>MAX_PACKET){console.error('Desktop agent sent oversized frame');endViewers();return;}
        if(agentBuffer.length<5+len)break;
        const pkt=agentBuffer.subarray(0,5+len);agentBuffer=agentBuffer.subarray(5+len);
        if(pkt[0]===1){agentMeta=Buffer.from(pkt);agentReady=true;}
        else if(pkt[0]===2){
          // Per-command acknowledgement from the desktop agent: never forward
          // acknowledgements to screen viewers or mix them into JPEG frames.
          try {
            const ack=JSON.parse(pkt.subarray(5).toString('utf8'));
            const waiter=pendingInput.get(ack.id);
            if(waiter){
              pendingInput.delete(ack.id);clearTimeout(waiter.timer);
              ack.ok===true?waiter.resolve():waiter.reject(new Error(ack.error||'Desktop input rejected'));
            }
          } catch(e){console.error('Invalid desktop input acknowledgement:',e.message);}
          continue;
        } else if(pkt[0]!==0)continue;
        for(const v of viewers) if(v.res.writable&&!v.busy){v.busy=!v.res.write(pkt);}
      }
    });
    p.on('close',code=>{
      if(agent!==p)return;
      console.log('Desktop agent exited:',code);
      for(const v of viewers)try{v.res.end();}catch{}
      viewers.clear();endAgent();
    });
    return true;
  }
  function act(action, callback) {
    if (options.disableActions) return callback(new Error('Disabled in tests'));
    if (process.platform!=='win32')return callback(new Error('Requires Windows'));
    const delay=Math.max(0,Math.min(300,Number(options.delaySeconds ?? 10)||0));
    const cmd = {
      shutdown:['shutdown',['/s','/t',String(delay)]], restart:['shutdown',['/r','/t',String(delay)]],
      logoff:['shutdown',['/l']],sleep:['rundll32.exe',['powrprof.dll,SetSuspendState','0,1,0']],
      lock:['rundll32.exe',['user32.dll,LockWorkStation']],cancel:['shutdown',['/a']],
    };
    if(cmd[action])return execFile(cmd[action][0],cmd[action][1],callback);
    // Media keys are sent by standard Windows WScript Shell (no screen/keyboard injection scripts).
    const mapping={volup:175,voldown:174,mute:173,playpause:179,next:176,prev:177};
    const code=mapping[action], times=['volup','voldown'].includes(action)?5:1;
    const script=`$w=New-Object -ComObject WScript.Shell;1..${times}|ForEach-Object{$w.SendKeys([char]${code})}`;
    return execFile('powershell.exe',['-NoProfile','-Command',script],callback);
  }
  let prevCpu=os.cpus(),cpu=0;
  const cpuClock=setInterval(()=>{const now=os.cpus();let total=0,idle=0;now.forEach((c,i)=>{for(const k in c.times)total+=c.times[k]-(prevCpu[i]?.times[k]||0);idle+=c.times.idle-(prevCpu[i]?.times.idle||0);});cpu=total?Math.max(0,Math.round(100*(1-idle/total))):0;prevCpu=now;},3000);
  cpuClock.unref();
  const server=http.createServer(async(req,res)=>{
    const ip=req.socket.remoteAddress;
    // Tunnel mode accepts only the local connector and explicitly named host.
    // Never use X-Forwarded-For / CF-Connecting-IP as proof of authorization.
    const viaTunnel = !!tunnelHostname && loopbackIP(ip) && sameHost(req.headers.host,new Set([tunnelHostname]));
    const allowed = tunnelHostname ? viaTunnel : privateIP(ip) && sameHost(req.headers.host,hostnames);
    if(!allowed)return respond(res,403,{error:tunnelHostname?'Tunnel host only':'Local network only'});
    if(req.headers.origin){try{const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host)return respond(res,403,{error:'Cross-origin request rejected'});}catch{return respond(res,403,{error:'Invalid origin'});}}
    let pathname;
    try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return respond(res,400,{error:'Bad URL'});}
    try{
      if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});
        return res.end(fs.readFileSync(path.join(ROOT,'index.html')));
      }
      if(req.method==='GET'&&pathname==='/manifest.json')return respond(res,200,{name:'PC Remote',short_name:'PC Remote',start_url:'/',display:'standalone',theme_color:'#07090f',background_color:'#07090f'});
      if(req.method==='GET'&&pathname==='/api/ping'){
        const paired=!!auth(req);
        return respond(res,200,{ok:true,paired,requirePin,...(paired?{name:hostname,screen:enabled&&process.platform==='win32'}:{})});
      }
      if(req.method==='POST'&&pathname==='/api/pair'){
        if(!requiresHeader(req))return respond(res,403,{error:'Request header missing'});
        const attempt=strikes.get(ip)||{count:0,until:0};
        if(attempt.until>Date.now())return respond(res,429,{error:'Too many attempts. Try again later.'});
        const b=await jsonBody(req);
        // Fixed time compare even for incorrect length.
        const got=Buffer.from(String(b.pin||''));const good=Buffer.from(pin);
        const valid=got.length===good.length&&crypto.timingSafeEqual(got,good);
        if(requirePin && !valid){attempt.count++;if(attempt.count>=5){attempt.until=Date.now()+15*60*1000;attempt.count=0;}strikes.set(ip,attempt);return respond(res,401,{error:'Incorrect PIN'});}
        strikes.delete(ip);
        const token=crypto.randomBytes(32).toString('hex');
        sessions.set(token,{ip,until:Date.now()+SESSION_TIME});record(ip,'Phone paired');
        return respond(res,200,{ok:true}, {'Set-Cookie':`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${viaTunnel?'; Secure':''}`});
      }
      const token=auth(req);
      if(!token)return respond(res,401,{error:'Pair your phone first'});
      if(req.method==='GET'&&pathname==='/api/status')return respond(res,200,{ok:true,name:hostname,uptime:Math.round(os.uptime()),cpu,mem:Math.round(100*(1-os.freemem()/os.totalmem())),log:activity.slice(0,6),screen:enabled&&process.platform==='win32'});
      if(req.method==='POST'&&pathname==='/api/unpair'){
        if(!requiresHeader(req))return respond(res,403,{error:'Request header missing'});
        sessions.delete(token);for(const v of [...viewers])if(v.token===token){try{v.res.end();}catch{} viewers.delete(v);}if(!viewers.size)endAgent();
        record(ip,'Phone unpaired');return respond(res,200,{ok:true},{'Set-Cookie':`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`});
      }
      if(req.method==='GET'&&pathname==='/api/screen'){
        if(!enabled||!requiresHeader(req))return respond(res,403,{error:'Screen sharing disabled'});
        const preset=new URL(req.url,'http://localhost').searchParams.get('p')||'med';
        if(!PRESETS[preset])return respond(res,400,{error:'Invalid quality setting'});
        if(!startAgent(preset))return respond(res,503,{error:'Desktop agent unavailable. Build it on Windows using start.bat.'});
        res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.socket.setNoDelay(true);
        const v={res,token,busy:false};viewers.add(v);res.on('drain',()=>v.busy=false);
        if(agentMeta)res.write(agentMeta);
        // An already-open stream must not outlive the pairing session.
        const expiration=sessions.get(token).until-Date.now();
        const expiry=setTimeout(()=>{if(!res.writableEnded)res.end();},Math.max(0,expiration));
        expiry.unref();
        record(ip,'Remote screen opened');console.log(`[Sharing screen with ${ip}. Close host window to stop.]`);
        res.on('close',()=>{clearTimeout(expiry);viewers.delete(v);if(!viewers.size)endAgent();});
        return;
      }
      if(req.method==='POST'&&pathname==='/api/input'){
        if(!enabled||!requiresHeader(req))return respond(res,403,{error:'Remote input disabled'});
        if(!agent||!agentReady||!Array.from(viewers).some(v=>v.token===token))return respond(res,409,{error:'No active screen session'});
        const b=await jsonBody(req,100000);
        if(!Array.isArray(b.cmds))return respond(res,400,{error:'Invalid commands'});
        if(b.cmds.length>50||!b.cmds.every(validInput))return respond(res,400,{error:'Invalid input'});
        if(!agent.stdin.writable)return respond(res,503,{error:'Desktop agent disconnected'});
        if(b.wait===true){
          // Typed text and key actions are acknowledged only after the Windows
          // agent processes them. Unacknowledged mouse movement stays fast.
          if(b.cmds.length<1||b.cmds.length>25||!b.cmds.every(c=>/^(text|paste|key) /.test(c)))
            return respond(res,400,{error:'Invalid typing request'});
          const tagged=[];
          const completion=b.cmds.map(c=>new Promise((resolve,reject)=>{
            const id=crypto.randomBytes(8).toString('hex');
            const timer=setTimeout(()=>{pendingInput.delete(id);reject(new Error('Windows input acknowledgement timed out'));},15000);
            timer.unref();
            pendingInput.set(id,{resolve,reject,timer});
            tagged.push(`ack ${id} ${c}`);
          }));
          try {
            agent.stdin.write(tagged.join('\n')+'\n');
            await Promise.all(completion);
            return respond(res,200,{ok:true,delivered:true});
          } catch(e) {
            return respond(res,503,{error:e.message});
          }
        }
        if(b.cmds.length)agent.stdin.write(b.cmds.join('\n')+'\n');
        return respond(res,200,{ok:true});
      }
      if(req.method==='POST'&&pathname==='/api/cmd'){
        if(!requiresHeader(req))return respond(res,403,{error:'Request header missing'});
        const b=await jsonBody(req);if(!commands.has(b.action))return respond(res,400,{error:'Unknown action'});
        record(ip,`Requested ${b.action}`);
        return act(b.action,e=>respond(res,e?500:200,e?{error:`Action failed: ${e.message}`}:{ok:true,msg:`${b.action} requested`}));
      }
      return respond(res,404,{error:'Not found'});
    }catch(err){return respond(res,err.message==='Request too large'?413:400,{error:err.message});}
  });
  server.on('close',()=>{clearInterval(cpuClock);endViewers();});
  return {server,pin,port,addresses:interfaces,stop:endViewers};
}
if(require.main===module){
  if(process.argv.includes('--port')){console.log(Number(process.env.PORT||7666));process.exit(0);}
  let config={};
  try {config=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));} catch {}
  const app=createApp({screen:config.screen!==false,delaySeconds:config.delaySeconds,requirePin:config.requirePin===true,tunnelHostname:config.tunnelHostname});
  app.server.listen(app.port,config.tunnelHostname?'127.0.0.1':'0.0.0.0',()=>{
    const actual=app.server.address().port;
    const ip=app.addresses.find(a=>a.startsWith('192.168.'))||app.addresses[0]||'127.0.0.1';
    console.log(`\nPC Remote — visible, private LAN session\nPhone URL: ${config.tunnelHostname?'https://'+tunnelHost(config.tunnelHostname):'http://'+ip+':'+actual}\n${config.requirePin===true?'PAIRING PIN: '+app.pin:'Automatic connection enabled. Use only trusted LAN devices or an Access-protected tunnel.'}\nKeep this terminal open; Ctrl+C stops sharing.\nNever forward port ${actual} to the internet.\n`);
  });
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is in use. Close the previous PC Remote terminal before starting a new instance.':e.message);process.exitCode=1;});
}
module.exports={createApp,privateIP,validInput};
