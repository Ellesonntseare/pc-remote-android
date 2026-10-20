'use strict';
// Visible, LAN-only Windows PC Remote service. Runs only while user keeps the host console open.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { WebSocketServer, WebSocket } = require('ws');
const ROOT = __dirname;
const PRESETS = { low: [35, 0.40, 6], med: [50, 0.60, 10], high: [70, 0.85, 12], hd: [85, 1.0, 15] };
const commands = new Set(['shutdown','restart','logoff','sleep','lock','volup','voldown','mute','playpause','next','prev','cancel']);
const COOKIE_NAME = 'pc_remote_session';
const SESSION_TIME = 2 * 60 * 60 * 1000;
const MAX_PACKET = 8 * 1024 * 1024;
// Explicit public asset map: no arbitrary filesystem paths or paired data.
const PWA_ASSETS = new Map([
  ['/screen-packets.js', ['screen-packets.js', 'text/javascript; charset=utf-8']],
  ['/input-transport.js', ['input-transport.js', 'text/javascript; charset=utf-8']],
  ['/pwa.js', ['pwa.js', 'text/javascript; charset=utf-8']],
  ['/pwa.css', ['pwa.css', 'text/css; charset=utf-8']],
  ['/screen-tools.js', ['screen-tools.js', 'text/javascript; charset=utf-8']],
  ['/screen-tools.css', ['screen-tools.css', 'text/css; charset=utf-8']],
  ['/desktop-controls.js', ['desktop-controls.js', 'text/javascript; charset=utf-8']],
  ['/desktop-controls.css', ['desktop-controls.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/icons/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icons/icon-512.png', ['icon-512.png', 'image/png']],
  ['/icons/icon-maskable-512.png', ['icon-maskable-512.png', 'image/png']],
  ['/icons/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']],
]);
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
  if (verb === 'text' || verb === 'paste' || verb === 'edit') {
    const limit = verb === 'text' ? 600 : 65536;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v) || v.length % 4 !== 0 || v.length > Math.ceil(limit / 3) * 4) return false;
    const bytes=Buffer.from(v,'base64');
    if(bytes.length < 1 || bytes.length > limit || bytes.toString('base64') !== v) return false;
    try {
      const decoded = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if (verb !== 'edit') return true;
      const edit = JSON.parse(decoded);
      if (!edit || Array.isArray(edit) || typeof edit !== 'object' ||
          Object.keys(edit).sort().join(',') !== 'remove,text' ||
          !Number.isInteger(edit.remove) || edit.remove < 0 || edit.remove > 16000 ||
          typeof edit.text !== 'string' || edit.text.length > 16000 || edit.text.includes('\0')) return false;
      // JSON can escape isolated UTF-16 surrogates even when its bytes are valid UTF-8.
      for (let i=0; i<edit.text.length; i++) {
        const unit=edit.text.charCodeAt(i);
        if (unit>=0xd800 && unit<=0xdbff) {
          const next=edit.text.charCodeAt(++i);
          if (!(next>=0xdc00 && next<=0xdfff)) return false;
        } else if (unit>=0xdc00 && unit<=0xdfff) return false;
      }
      return true;
    } catch { return false; }
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
  let videoSequence=0,captureDemand=false,captureRequested=false,baseQuality=50,currentQuality=50,lastQualityChange=0;
  const inputSockets = new Set();
  const inputHeld = new WeakMap();
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
  const isTunnelRequest=req=>!!tunnelHostname&&loopbackIP(req.socket.remoteAddress)&&sameHost(req.headers.host,new Set([tunnelHostname]));
  const allowedRequest=req=>tunnelHostname?isTunnelRequest(req):privateIP(req.socket.remoteAddress)&&sameHost(req.headers.host,hostnames);
  function videoPacket(type,value){
    const payload=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(5);
    header[0]=type;header.writeUInt32BE(payload.length,1);return Buffer.concat([header,payload]);
  }
  function viewerMetadata(viewer){return videoPacket(1,{...JSON.parse(agentMeta.subarray(5).toString('utf8')),streamId:viewer.streamId});}
  function requestVideoFrame(){
    if(!captureDemand||captureRequested||!agent?.stdin.writable)return;
    if(!Array.from(viewers).some(v=>v.res.writable&&!v.busy&&v.inFlight.size<2))return;
    captureRequested=true;agent.stdin.write('frame\n');
  }
  function updateVideoDemand(){
    const next=viewers.size>0&&Array.from(viewers).every(v=>v.feedbackSocket?.readyState===WebSocket.OPEN);
    if(next!==captureDemand){captureDemand=next;captureRequested=false;if(agent?.stdin.writable)agent.stdin.write('flow '+(next?1:0)+'\n');}
    requestVideoFrame();
  }
  function acknowledgeVideo(viewer,id){
    if(!Number.isSafeInteger(id)||!viewer.inFlight.has(id))return;
    const elapsed=Math.max(1,Date.now()-viewer.inFlight.get(id));
    for(const old of viewer.inFlight.keys())if(old<=id)viewer.inFlight.delete(old);
    viewer.deliveryMs=viewer.deliveryMs?viewer.deliveryMs*.75+elapsed*.25:elapsed;
    const delivery=Math.max(...Array.from(viewers,v=>v.feedbackSocket?v.deliveryMs||0:0)),now=Date.now();
    let next=currentQuality;
    if(delivery>240&&now-lastQualityChange>1500)next=Math.max(Math.min(baseQuality,40),currentQuality-10);
    else if(delivery>0&&delivery<110&&now-lastQualityChange>5000)next=Math.min(baseQuality,currentQuality+5);
    if(next!==currentQuality&&agent?.stdin.writable){currentQuality=next;lastQualityChange=now;agent.stdin.write('quality '+next+'\n');}
    requestVideoFrame();
  }
  function disconnectInput(ws,code=1008,message='Session ended') {
    if(ws.readyState>=WebSocket.CLOSING)return;
    ws.close(code,message);
    const timer=setTimeout(()=>ws.terminate(),250);timer.unref();
    ws.once('close',()=>clearTimeout(timer));
  }
  function closeInputSockets(token) {
    for(const entry of inputSockets)if(!token||entry.token===token)disconnectInput(entry.ws,1001,'Screen session ended');
  }
  function endAgent() {
    captureDemand=false;captureRequested=false;
    failPending('Desktop agent disconnected');
    const p=agent;agent=null;agentPreset=null;agentMeta=null;agentBuffer=Buffer.alloc(0);agentReady=false;
    if(p) {
      // EOF lets the desktop agent release remotely held keys/buttons before exit.
      // Keep a bounded fallback for a stalled capture/input process.
      const killTimer=setTimeout(()=>{try{p.kill();}catch{}},1000);
      killTimer.unref();
      p.once('close',()=>clearTimeout(killTimer));
      try {p.stdin.end();} catch {}
    }
  }
  function endViewers() {
    closeInputSockets();
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
    baseQuality=currentQuality=quality;lastQualityChange=Date.now();
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
        } else if(pkt[0]===4){captureRequested=false;requestVideoFrame();continue;}else if(pkt[0]!==0)continue;
        if(pkt[0]===1){for(const v of viewers)if(v.res.writable)v.res.write(viewerMetadata(v));continue;}
        captureRequested=false;
        const id=++videoSequence,marker=videoPacket(3,{id});
        for(const v of viewers)if(v.res.writable&&!v.busy){
          if(v.feedbackSocket&&v.inFlight.size>=2)continue;
          if(v.feedbackSocket)v.inFlight.set(id,Date.now());
          v.busy=!v.res.write(v.feedbackSocket?Buffer.concat([marker,pkt]):pkt);
        }
        requestVideoFrame();
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
  function trackInput(owner,cmds) {
    if(!owner)return;
    let held=inputHeld.get(owner);
    if(!held||held.agent!==agent){held={agent,buttons:new Set(),keys:new Set()};inputHeld.set(owner,held);}
    for(const command of cmds){
      const [kind,value]=command.split(' ');
      if(kind==='down')held.buttons.add(value);
      else if(kind==='up'||kind==='click')held.buttons.delete(value);
      else if(kind==='dbl')held.buttons.delete('l');
      else if(kind==='keydown')held.keys.add(value);
      else if(kind==='keyup'||kind==='key')held.keys.delete(value);
    }
  }
  function releaseInput(owner) {
    const held=inputHeld.get(owner);inputHeld.delete(owner);
    if(!held||held.agent!==agent||!agent?.stdin.writable)return;
    const commands=[...Array.from(held.buttons,button=>'up '+button),...Array.from(held.keys,key=>'keyup '+key)];
    if(commands.length)try{agent.stdin.write(commands.join('\n')+'\n');}catch{}
  }
  async function processInput(token,b,owner=null) {
    const result=(status,payload)=>({status,...payload});
    if(!enabled)return result(403,{error:'Remote input disabled'});
    if(!agent||!agentReady||!Array.from(viewers).some(v=>v.token===token))return result(409,{error:'No active screen session'});
    if(!b||typeof b!=='object'||Array.isArray(b)||!Array.isArray(b.cmds))return result(400,{error:'Invalid commands'});
    if(b.wait!==undefined&&typeof b.wait!=='boolean')return result(400,{error:'Invalid acknowledgement setting'});
    if(b.cmds.length>50||!b.cmds.every(validInput))return result(400,{error:'Invalid input'});
    if(!agent.stdin.writable)return result(503,{error:'Desktop agent disconnected'});
    if(agent.stdin.writableLength>262144||pendingInput.size>512)return result(429,{error:'PC input queue is busy'});
    if(b.wait===true){
      if(b.cmds.length<1||b.cmds.length>25||!b.cmds.every(c=>/^(text|paste|edit|key|combo) /.test(c)))
        return result(400,{error:'Invalid typing request'});
      const tagged=[],ids=[];
      const completion=b.cmds.map(c=>new Promise((resolve,reject)=>{
        const id=crypto.randomBytes(8).toString('hex');ids.push(id);
        const timer=setTimeout(()=>{pendingInput.delete(id);reject(new Error('Windows input acknowledgement timed out'));},15000);
        timer.unref();pendingInput.set(id,{resolve,reject,timer,owner});tagged.push(`ack ${id} ${c}`);
      }));
      try{
        agent.stdin.write(tagged.join('\n')+'\n');
        await Promise.all(completion);
        return result(200,{ok:true,delivered:true});
      }catch(e){return result(503,{error:e.message});}
      finally{
        for(const id of ids){const pending=pendingInput.get(id);if(pending){clearTimeout(pending.timer);pendingInput.delete(id);}}
      }
    }
    try{if(b.cmds.length){agent.stdin.write(b.cmds.join('\n')+'\n');trackInput(owner,b.cmds);}}
    catch(e){return result(503,{error:e.message});}
    return result(200,{ok:true});
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
    const viaTunnel = isTunnelRequest(req);
    const allowed = allowedRequest(req);
    if(!allowed)return respond(res,403,{error:tunnelHostname?'Tunnel host only':'Local network only. For remote.teamtrader.co.za, run start-cloudflare.bat on the Windows host and restart Cloudflare Tunnel.'});
    if(req.headers.origin){try{const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host)return respond(res,403,{error:'Cross-origin request rejected'});}catch{return respond(res,403,{error:'Invalid origin'});}}
    let pathname;
    try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return respond(res,400,{error:'Bad URL'});}
    try{
      if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
        const page=fs.readFileSync(path.join(ROOT,'index.html'));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws://${req.headers.host} wss://${req.headers.host}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'`,'X-Content-Type-Options':'nosniff'});
        return res.end(page);
      }
      if(req.method==='GET'&&(pathname==='/manifest.json'||pathname==='/manifest.webmanifest'))return respond(res,200,{
        id:'/',name:'PC Remote',short_name:'PC Remote',description:'Control your own Windows PC from your phone.',
        start_url:'/',scope:'/',display:'standalone',theme_color:'#07090f',background_color:'#07090f',
        icons:[
          {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
          {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
          {src:'/icons/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
        ]
      },{'Content-Type':'application/manifest+json; charset=utf-8'});
      if(req.method==='GET'&&PWA_ASSETS.has(pathname)){
        const [filename,type]=PWA_ASSETS.get(pathname);
        let asset;
        try{asset=fs.readFileSync(path.join(ROOT,'public',filename));}
        catch(e){if(e.code==='ENOENT')return respond(res,404,{error:'App file missing. Extract the complete update and restart the Windows host.'});throw e;}
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(pathname==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})});
        return res.end(asset);
      }
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
        sessions.delete(token);closeInputSockets(token);for(const v of [...viewers])if(v.token===token){try{v.res.end();}catch{} viewers.delete(v);}updateVideoDemand();if(!viewers.size)endAgent();
        record(ip,'Phone unpaired');return respond(res,200,{ok:true},{'Set-Cookie':`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`});
      }
      if(req.method==='GET'&&pathname==='/api/screen'){
        if(!enabled||!requiresHeader(req))return respond(res,403,{error:'Screen sharing disabled'});
        const preset=new URL(req.url,'http://localhost').searchParams.get('p')||'med';
        if(!PRESETS[preset])return respond(res,400,{error:'Invalid quality setting'});
        if(!startAgent(preset))return respond(res,503,{error:'Desktop agent unavailable. Build it on Windows using start.bat.'});
        res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
        res.socket.setNoDelay(true);
        const v={res,token,busy:false,streamId:crypto.randomBytes(12).toString('hex'),feedbackSocket:null,inFlight:new Map(),deliveryMs:0};viewers.add(v);res.on('drain',()=>{v.busy=false;requestVideoFrame();});
        updateVideoDemand();if(agentMeta)res.write(viewerMetadata(v));
        // An already-open stream must not outlive the pairing session.
        const expiration=sessions.get(token).until-Date.now();
        const expiry=setTimeout(()=>{if(!res.writableEnded)res.end();},Math.max(0,expiration));
        expiry.unref();
        record(ip,'Remote screen opened');console.log(`[Sharing screen with ${ip}. Close host window to stop.]`);
        res.on('close',()=>{clearTimeout(expiry);viewers.delete(v);updateVideoDemand();if(!viewers.size)endAgent();});
        return;
      }
      if(req.method==='POST'&&pathname==='/api/input'){
        if(!requiresHeader(req))return respond(res,403,{error:'Remote input disabled'});
        const b=await jsonBody(req,100000),outcome=await processInput(token,b);
        const {status,...payload}=outcome;return respond(res,status,payload);
      }
      if(req.method==='POST'&&pathname==='/api/cmd'){
        if(!requiresHeader(req))return respond(res,403,{error:'Request header missing'});
        const b=await jsonBody(req);if(!commands.has(b.action))return respond(res,400,{error:'Unknown action'});
        record(ip,`Requested ${b.action}`);
        return act(b.action,e=>respond(res,e?500:200,e?{error:`Action failed: ${e.message}`}:{ok:true,msg:`${b.action} requested`}));
      }
      return respond(res,404,{error:'Not found'});
    }catch(err){if(res.headersSent){res.destroy();return;}return respond(res,err.message==='Request too large'?413:400,{error:err.message});}
  });
  const inputStream=new WebSocketServer({noServer:true,maxPayload:100000,perMessageDeflate:false});
  function rejectUpgrade(socket,status,message) {
    const body=JSON.stringify({error:message});
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  server.on('upgrade',(req,socket,head)=>{
    let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return rejectUpgrade(socket,400,'Bad URL');}
    if(pathname!=='/api/input-stream')return rejectUpgrade(socket,404,'Not found');
    if(!allowedRequest(req))return rejectUpgrade(socket,403,'Input stream host rejected');
    try{
      const origin=new URL(req.headers.origin);
      if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)return rejectUpgrade(socket,403,'Cross-origin request rejected');
    }catch{return rejectUpgrade(socket,403,'Request origin required');}
    const token=auth(req);
    if(!token)return rejectUpgrade(socket,401,'Pair your phone first');
    if(!enabled)return rejectUpgrade(socket,403,'Remote input disabled');
    if(!agent||!agentReady||!Array.from(viewers).some(v=>v.token===token))return rejectUpgrade(socket,409,'No active screen session');
    const screenId=new URL(req.url,'http://localhost').searchParams.get('screen');
    const viewer=screenId?Array.from(viewers).find(v=>v.token===token&&v.streamId===screenId):null;
    if(screenId&&!viewer)return rejectUpgrade(socket,409,'Screen session changed');
    inputStream.handleUpgrade(req,socket,head,ws=>{
      const entry={ws,token};inputSockets.add(entry);
      if(viewer){viewer.feedbackSocket=ws;viewer.inFlight.clear();updateVideoDemand();}
      const expiry=setTimeout(()=>disconnectInput(ws,1008,'Session expired'),Math.max(0,sessions.get(token).until-Date.now()));expiry.unref();
      const activeIds=new Set();
      const send=payload=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));};
      ws.on('error',()=>{});
      ws.on('message',(data,binary)=>{
        if(ws.readyState!==WebSocket.OPEN)return;
        if(auth(req)!==token){send({status:401,error:'Session expired'});disconnectInput(ws,1008,'Session expired');return;}
        let body;try{if(binary)throw Error();body=JSON.parse(data.toString('utf8'));}catch{send({status:400,error:'Invalid JSON input'});return;}
        if(!body||typeof body!=='object'||Array.isArray(body)){send({status:400,error:'Invalid commands'});return;}
        if(Object.hasOwn(body,'frameAck')){
          if(viewer?.feedbackSocket===ws)acknowledgeVideo(viewer,body.frameAck);
          return;
        }
        const id=body.id,hasId=id!==undefined;
        if(hasId&&!((Number.isSafeInteger(id)&&id>=0)||(typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)))){send({status:400,error:'Invalid request ID'});return;}
        if(body.wait===true&&!hasId){send({status:400,error:'Acknowledged input requires a request ID'});return;}
        if(hasId&&activeIds.has(id)){send({id,status:400,error:'Duplicate request ID'});return;}
        if(activeIds.size>=32){send({...hasId&&{id},status:429,error:'Too many pending input requests'});return;}
        if(hasId)activeIds.add(id);
        // processInput validates and writes synchronously before its first await.
        // Movement packets therefore stream in receive order without a round trip.
        processInput(token,body,ws).then(outcome=>{
          if(hasId||outcome.status!==200)send({...hasId&&{id},...outcome});
        }).catch(()=>send({...hasId&&{id},status:503,error:'Input stream failed'}))
          .finally(()=>{if(hasId)activeIds.delete(id);});
      });
      ws.on('close',()=>{
        clearTimeout(expiry);inputSockets.delete(entry);releaseInput(ws);
        if(viewer?.feedbackSocket===ws){viewer.feedbackSocket=null;viewer.inFlight.clear();updateVideoDemand();}
        for(const [id,pending] of pendingInput)if(pending.owner===ws){clearTimeout(pending.timer);pendingInput.delete(id);pending.reject(new Error('Input stream disconnected'));}
      });
    });
  });
  server.on('close',()=>{clearInterval(cpuClock);endViewers();inputStream.close();});
  return {server,pin,port,addresses:interfaces,stop:endViewers};
}
if(require.main===module){
  if(process.argv.includes('--port')){console.log(Number(process.env.PORT||7666));process.exit(0);}
  let config={};
  try {config=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));}
  catch(e) { if(e.code!=='ENOENT'){console.error('Cannot load config.json:',e.message);process.exit(1);} }
  const app=createApp({screen:config.screen!==false,delaySeconds:config.delaySeconds,requirePin:config.requirePin===true,tunnelHostname:config.tunnelHostname});
  app.server.listen(app.port,config.tunnelHostname?'127.0.0.1':'0.0.0.0',()=>{
    const actual=app.server.address().port;
    const ip=app.addresses.find(a=>a.startsWith('192.168.'))||app.addresses[0]||'127.0.0.1';
    console.log(`\nPC Remote — visible, private LAN session\nPhone URL: ${config.tunnelHostname?'https://'+tunnelHost(config.tunnelHostname):'http://'+ip+':'+actual}\n${config.requirePin===true?'PAIRING PIN: '+app.pin:'Automatic connection enabled. Use only trusted LAN devices or an Access-protected tunnel.'}\nKeep this terminal open; Ctrl+C stops sharing.\nNever forward port ${actual} to the internet.\n`);
  });
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is in use. Close the previous PC Remote terminal before starting a new instance.':e.message);process.exitCode=1;});
}
module.exports={createApp,privateIP,validInput};
