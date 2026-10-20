'use strict';
(() => {
  const screen=document.getElementById('rs');
  const view=document.getElementById('rsv');
  const canvas=document.getElementById('rsc');
  if(!screen||!view||!canvas)return;
  const toolbar=document.createElement('div');
  toolbar.id='screenTools';toolbar.className='screenTools';
  toolbar.innerHTML='<div class="screenConnectionGroup"><span id="screenConnection" role="status" aria-live="polite" data-state="closed">Screen closed</span><button type="button" id="rsReconnect">Reconnect</button></div><div class="screenViewGroup"><button type="button" id="rsFullscreen">Full screen</button><button type="button" id="rsZoomOut" aria-label="Zoom out">−</button><button type="button" id="rsZoomReset" aria-label="Reset zoom">100%</button><button type="button" id="rsZoomIn" aria-label="Zoom in">+</button><button type="button" id="rsPan" aria-pressed="false">Pan view</button></div><p id="rsZoomHint">Zoom in to read small text. Pan view moves the image without controlling the PC.</p>';
  screen.querySelector('.rsbar').after(toolbar);
  const stage=document.createElement('div');stage.id='screenStage';
  canvas.before(stage);stage.append(canvas);view.classList.add('screenZoomView');
  const status=toolbar.querySelector('#screenConnection');
  const reconnectButton=toolbar.querySelector('#rsReconnect');
  const fullButton=toolbar.querySelector('#rsFullscreen');
  fullButton.title='Show only the remote screen. Escape or a three-finger tap restores the controls.';
  const minus=toolbar.querySelector('#rsZoomOut');
  const plus=toolbar.querySelector('#rsZoomIn');
  const zoomButton=toolbar.querySelector('#rsZoomReset');
  const panButton=toolbar.querySelector('#rsPan');
  let zoom=1,pan=false,gesture=null,watchdog=null,lastRatio=0,reconnecting=false;
  let fullscreenRequest=0,requestedFullscreen=false;
  const fullscreenSupported=typeof screen.requestFullscreen==='function'&&document.fullscreenEnabled!==false;

  function announce(text,state){
    if(status.textContent!==text)status.textContent=text;
    status.dataset.state=state;
    reconnectButton.disabled=false;
  }
  function clearWatchdog(){clearTimeout(watchdog);watchdog=null;}
  function startWatchdog(message){
    clearWatchdog();
    watchdog=setTimeout(()=>{if(rs.on){announce(message,'stalled');rsPauseLive('Screen updates stopped. Check the connection, select the PC field again, then tap New field.');}},10000);
  }
  function displayRatio(){return rs.m?.w>0&&rs.m?.h>0?rs.m.w/rs.m.h:(canvas.width/canvas.height||1);}
  function adaptHeight(){screen.classList.toggle('screenVeryShort',screen.clientHeight>0&&screen.clientHeight<=550);}
  function layout(keepCenter=true){
    const w=view.clientWidth,h=view.clientHeight;if(!w||!h)return;
    const oldW=stage.offsetWidth||w,oldH=stage.offsetHeight||h;
    const centerX=(view.scrollLeft+w/2)/oldW,centerY=(view.scrollTop+h/2)/oldH;
    const ratio=displayRatio();lastRatio=ratio;
    const fitW=Math.min(w,h*ratio),fitH=fitW/ratio;
    const imageW=fitW*zoom,imageH=fitH*zoom;
    const stageW=Math.max(w,imageW),stageH=Math.max(h,imageH);
    stage.style.width=stageW+'px';stage.style.height=stageH+'px';
    canvas.style.width=imageW+'px';canvas.style.height=imageH+'px';
    if(keepCenter){view.scrollLeft=centerX*stageW-w/2;view.scrollTop=centerY*stageH-h/2;}
  }
  function panUI(){
    panButton.disabled=zoom===1;
    panButton.textContent=pan?'Control PC':'Pan view';
    panButton.setAttribute('aria-pressed',String(pan));
    view.classList.toggle('screenPanning',pan);
    toolbar.querySelector('#rsZoomHint').textContent=pan?'Drag the image to look around. Tap Control PC to click or type on the PC.':'Zoom in to read small text. Pan view moves the image without controlling the PC.';
  }
  function stopGesture(){gesture=null;}
  function setZoom(value){
    zoom=Math.min(4,Math.max(1,Math.round(value*4)/4));
    zoomButton.textContent=Math.round(zoom*100)+'%';
    minus.disabled=zoom===1;plus.disabled=zoom===4;
    if(zoom===1){pan=false;stopGesture();}
    layout();panUI();
  }
  function imageBox(){
    const rect=canvas.getBoundingClientRect();
    return {x:rect.left,y:rect.top,w:rect.width,h:rect.height};
  }
  function connecting(){
    announce('Connecting…','connecting');
    reconnectButton.disabled=true;
    startWatchdog('Connection is taking longer. Try Reconnect.');
    requestAnimationFrame(()=>layout(false));
  }
  function metadata(){
    announce('Waiting for screen…','connecting');reconnectButton.disabled=true;
    startWatchdog('No screen image yet. Try Reconnect.');layout();
  }
  function frame(){
    if(!rs.on)return;
    announce('Live','live');
    if(lastRatio!==displayRatio())layout();
    startWatchdog('No new screen image. Try Reconnect.');
  }
  function disconnected(message='Disconnected — reconnecting…'){
    clearWatchdog();announce(message,'disconnected');
  }
  function closed(){
    fullscreenRequest++;requestedFullscreen=false;
    clearWatchdog();announce('Screen closed','closed');stopGesture();
    setClean(false);screen.classList.remove('screenExpanded');
    if(document.fullscreenElement===screen)document.exitFullscreen().catch(()=>{});
    setZoom(1);updateFullscreen();
  }
  async function reconnect(){
    if(!rs.on||reconnecting)return;
    reconnecting=true;
    // An input may already have reached Windows. Preserve the draft and start a
    // new context rather than replaying a command with an uncertain outcome.
    rsPauseLive('Reconnecting. Check the PC field, then tap New field before typing.');
    if(g){clearTimeout(g.lp);g=null;}
    mouseDrag=false;qq=[];stopGesture();
    announce('Reconnecting…','connecting');reconnectButton.disabled=true;
    const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),2000);
    try{
      // Release through the still-open screen session before replacing it. A
      // queued release could otherwise be discarded with the old input queue.
      await api('/api/input',{method:'POST',body:JSON.stringify({cmds:['up l','up r','up m']}),signal:abort.signal});
    }catch{}finally{clearTimeout(timeout);}
    try{if(rs.on){rs.m=null;rsRun();}}
    finally{reconnecting=false;}
  }
  function setClean(enabled){
    screen.classList.toggle('screenClean',enabled);
    document.body.classList.toggle('screenCleanActive',enabled);
    if(enabled){
      rsPrefsClose();rsTypeClose();setZoom(1);stopGesture();
      canvas.focus({preventScroll:true});
    }
    requestAnimationFrame(()=>layout());
  }
  function updateFullscreen(){
    const active=document.fullscreenElement===screen;
    if(active&&!requestedFullscreen){setClean(false);document.exitFullscreen().catch(()=>{});return;}
    if(!active&&!screen.classList.contains('screenExpanded')){setClean(false);if(requestedFullscreen){requestedFullscreen=false;fullscreenRequest++;}}
    fullButton.textContent=active?'Exit full screen':fullscreenSupported?'Full screen':screen.classList.contains('screenExpanded')?'Show controls':'Expand view';
    fullButton.setAttribute('aria-pressed',String(active||screen.classList.contains('screenExpanded')));
    requestAnimationFrame(()=>layout());
  }
  function restoreControls(){
    fullscreenRequest++;requestedFullscreen=false;
    setClean(false);screen.classList.remove('screenExpanded');
    if(document.fullscreenElement===screen)document.exitFullscreen().catch(()=>{});
    updateFullscreen();
  }
  async function fullscreen(){
    if(document.fullscreenElement===screen||screen.classList.contains('screenClean')){restoreControls();return;}
    if(fullscreenSupported){
      const request=++fullscreenRequest;requestedFullscreen=true;setClean(true);
      try{
        await screen.requestFullscreen({navigationUI:'hide'});
        if(request!==fullscreenRequest){if(document.fullscreenElement===screen)await document.exitFullscreen();return;}
      }catch{if(request===fullscreenRequest){requestedFullscreen=false;setClean(false);msg('Full screen is unavailable here. Install PC Remote for a standalone view.');}}
      updateFullscreen();return;
    }
    screen.classList.add('screenExpanded');setClean(true);updateFullscreen();
  }

  // Reserve a local way out before desktop input can forward Escape to Windows.
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&screen.classList.contains('screenClean')){
      event.preventDefault();event.stopImmediatePropagation();restoreControls();
    }
  },true);
  let exitTouch=null;
  view.addEventListener('touchstart',event=>{
    if(!screen.classList.contains('screenClean'))return;
    if(event.touches.length>=3){
      consume(event);
      if(g){clearTimeout(g.lp);if(g.dr)qc('up l');g=null;}
      exitTouch={at:performance.now(),points:Array.from(event.touches,t=>({id:t.identifier,x:t.clientX,y:t.clientY})),moved:false};
    }else if(exitTouch)consume(event);
  },{capture:true,passive:false});
  view.addEventListener('touchmove',event=>{
    if(!exitTouch)return;consume(event);
    for(const touch of event.touches){const initial=exitTouch.points.find(p=>p.id===touch.identifier);if(initial&&Math.hypot(touch.clientX-initial.x,touch.clientY-initial.y)>20)exitTouch.moved=true;}
  },{capture:true,passive:false});
  view.addEventListener('touchend',event=>{
    if(!exitTouch)return;consume(event);
    if(event.touches.length)return;
    const tap=!exitTouch.moved&&performance.now()-exitTouch.at<700;exitTouch=null;
    if(tap)restoreControls();
  },{capture:true,passive:false});
  view.addEventListener('touchcancel',event=>{if(exitTouch){consume(event);exitTouch=null;}},{capture:true,passive:false});

  // Preserve the phone keyboard while pressing view controls; keyboard users
  // can still focus the buttons through normal Tab navigation.
  toolbar.addEventListener('mousedown',event=>event.preventDefault());
  reconnectButton.addEventListener('click',reconnect);
  fullButton.addEventListener('click',()=>fullscreen().catch(()=>msg('Could not change full-screen mode.')));
  minus.addEventListener('click',()=>setZoom(zoom-.25));
  plus.addEventListener('click',()=>setZoom(zoom+.25));
  zoomButton.addEventListener('click',()=>setZoom(1));
  panButton.addEventListener('click',()=>{
    if(zoom===1)return;
    if(!rsCanPoint())return;
    pan=!pan;stopGesture();panUI();
  });
  document.addEventListener('fullscreenchange',updateFullscreen);

  function startPan(x,y){gesture={x,y,left:view.scrollLeft,top:view.scrollTop};}
  function movePan(x,y){if(gesture){view.scrollLeft=gesture.left+gesture.x-x;view.scrollTop=gesture.top+gesture.y-y;}}
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  // Capture local pan gestures before the controller's remote pointer handlers.
  view.addEventListener('pointerdown',event=>{
    if(!pan||event.pointerType!=='mouse')return;
    consume(event);view.setPointerCapture(event.pointerId);startPan(event.clientX,event.clientY);
  },true);
  view.addEventListener('pointermove',event=>{if(!pan||event.pointerType!=='mouse')return;consume(event);movePan(event.clientX,event.clientY);},true);
  view.addEventListener('pointerup',event=>{if(!pan||event.pointerType!=='mouse')return;consume(event);stopGesture();},true);
  view.addEventListener('pointercancel',event=>{if(!pan||event.pointerType!=='mouse')return;consume(event);stopGesture();},true);
  view.addEventListener('touchstart',event=>{if(!pan)return;consume(event);const touch=event.touches[0];if(touch)startPan(touch.clientX,touch.clientY);},{capture:true,passive:false});
  view.addEventListener('touchmove',event=>{if(!pan)return;consume(event);const touch=event.touches[0];if(touch)movePan(touch.clientX,touch.clientY);},{capture:true,passive:false});
  view.addEventListener('touchend',event=>{if(!pan)return;consume(event);stopGesture();},{capture:true,passive:false});
  view.addEventListener('touchcancel',event=>{if(!pan)return;consume(event);stopGesture();},{capture:true,passive:false});
  view.addEventListener('wheel',event=>{if(!pan)return;consume(event);view.scrollLeft+=event.deltaX;view.scrollTop+=event.deltaY;},{capture:true,passive:false});
  new ResizeObserver(()=>layout()).observe(view);
  new ResizeObserver(()=>{adaptHeight();layout();}).observe(screen);
  window.PCRScreenTools={connecting,metadata,frame,disconnected,closed,imageBox,reconnect,setZoom,restoreControls};
  setZoom(1);updateFullscreen();
})();
