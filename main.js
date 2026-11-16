const { app, BrowserWindow, ipcMain, session, shell, desktopCapturer, webContents, clipboard, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

process.on('uncaughtException', (error) => { console.error('CRITICAL:', error); });
process.on('unhandledRejection', (reason) => { console.error('CRITICAL:', reason); });

// Режим совместимости графики: если файл-флаг есть, видеокарта не используется (лечит мигание)
const GFX_FLAG = path.join(app.getPath('userData'), 'gfx-compat');
if (fs.existsSync(GFX_FLAG)) app.disableHardwareAcceleration();

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,SpareRendererForSitePerProcess,MediaRouter');
app.commandLine.appendSwitch('disable-device-discovery-notifications');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;
let adBlockEnabled = true;
let activeDownloads = 0;

// Настройки, которые страница присылает при запуске
const flags = { blockPopups: false, allowMedia: true, dnt: false, confirmExit: true };
const SAFE_PERMS = new Set(['fullscreen', 'clipboard-sanitized-write', 'notifications', 'pointerLock', 'window-management', 'speaker-selection']);
function permissionAllowed(permission) {
  if (permission === 'media' || permission === 'display-capture') return flags.allowMedia;
  return SAFE_PERMS.has(permission);
}
let blocker = null;
let forceClose = false;

// Чтобы случайная ошибка не закрывала браузер
process.on('uncaughtException', (err) => console.error('Ошибка:', err));
process.on('unhandledRejection', (err) => console.error('Ошибка:', err));
async function fileIconDataUrl(p) {
  try { return (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch (err) { return ''; }
}

const OFFLINE_HTML = "<!DOCTYPE html>\n<html lang=\"ru\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Dash Cube</title>\n<style>\n:root{--bg:#120a2e;--fg:#fff4d6;--acc:#ffb703;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\nhtml,body{height:100%;margin:0}\nbody{background:var(--bg);color:var(--fg);font-family:\"Trebuchet MS\",Verdana,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none}\n#wrap{position:relative;width:100%;max-width:900px;aspect-ratio:2/1;max-height:100%}\ncanvas#c{width:100%;height:100%;display:block;border-radius:10px}\n.scr{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:2%;text-align:center;background:rgba(18,10,46,.78);border-radius:10px}\n.scr.on{display:flex}\nh1{font-size:clamp(28px,7vw,60px);margin:0;color:var(--acc)}\nh2{font-size:clamp(20px,4vw,34px);margin:0}\np{margin:0;font-size:clamp(12px,2.4vw,20px)}\nbutton{font:inherit;font-size:clamp(13px,2.6vw,22px);font-weight:bold;color:var(--fg);background:#3a2a8c;border:3px solid var(--acc);border-radius:10px;padding:.5em 1.4em;cursor:pointer;min-width:30%}\nbutton:active{transform:scale(.96)}\nbutton:focus-visible{outline:3px solid #fff;outline-offset:2px}\nbutton.big{background:var(--acc);color:#1b1140;font-size:clamp(18px,4vw,34px)}\nbutton.arrow{min-width:0;padding:.3em .7em}\n.row{display:flex;align-items:center;gap:3%;justify-content:center;width:100%}\n#card{min-width:42%;padding:2% 3%;border:3px solid var(--fg);border-radius:12px;background:#2a1a66}\n#card b{display:block;font-size:clamp(18px,3.6vw,30px)}\n#pv{width:clamp(70px,16vw,130px);height:auto;aspect-ratio:1}\n#menuBtn{position:absolute;top:2%;left:2%;display:none;min-width:0;padding:.2em .6em;font-size:clamp(12px,2.4vw,20px)}\n#menuBtn.on{display:block}\n</style></head>\n<body>\n<div id=\"wrap\">\n<canvas id=\"c\" width=\"900\" height=\"450\"></canvas>\n<button id=\"menuBtn\">☰ Меню</button>\n<div class=\"scr on\" id=\"main\"><h1 id=\"title\">Dash Cube</h1><button class=\"big\" data-go=\"levels\">Играть</button><button data-go=\"garage\">Персонажи</button><button data-go=\"settings\">Настройки</button></div>\n<div class=\"scr\" id=\"levels\"><h2>Выбор уровня</h2><div class=\"row\"><button class=\"arrow\" id=\"lp\" aria-label=\"Предыдущий\">◀</button><div id=\"card\"></div><button class=\"arrow\" id=\"ln\" aria-label=\"Следующий\">▶</button></div><button data-tg=\"bot\"></button><button class=\"big\" id=\"playBtn\">Старт</button><button data-go=\"main\">Назад</button></div>\n<div class=\"scr\" id=\"garage\"><h2>Персонажи</h2><div class=\"row\"><button class=\"arrow\" id=\"gp\" aria-label=\"Предыдущий\">◀</button><canvas id=\"pv\" width=\"120\" height=\"120\"></canvas><button class=\"arrow\" id=\"gn\" aria-label=\"Следующий\">▶</button></div><p id=\"skinName\"></p><button data-go=\"main\">Готово</button></div>\n<div class=\"scr\" id=\"end\"><h1 id=\"endT\"></h1><p id=\"endP\"></p><button class=\"big\" id=\"retry\">Заново</button><button id=\"toMenu\">В меню</button></div>\n<div class=\"scr\" id=\"settings\"><h2>Настройки</h2><button data-tg=\"sfx\"></button><button data-tg=\"music\"></button><button data-tg=\"bot\"></button><button id=\"reset\">Сбросить прогресс</button><button data-go=\"main\">Назад</button></div>\n<div class=\"scr\" id=\"egg\"><h1>🤖 Привет!</h1><p>Эту игру создал Claude — нейросеть от Anthropic.</p><p>Открыт секретный скин «Claude»!</p><button class=\"big\" id=\"eggOk\">Круто</button></div>\n</div>\n<script>\n// LOGIC-START\nconst DEPTH=3,W=900,H=450,G=380,S=40,GRAV=2600,JUMP=830,PX=150,DT=1/60;\nfunction rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}\nconst LEVELS=[\n{name:'Первый шаг',diff:1,speed:300,gap:[7,9],seed:11,count:35,col:'#3b1f8f',pats:[0,0,1,3]},\n{name:'Неоновый бег',diff:2,speed:330,gap:[6,8],seed:22,count:50,col:'#7a1f6b',pats:[0,1,1,2,3,4,9]},\n{name:'Зигзаг',diff:3,speed:360,gap:[5,7],seed:36,count:65,col:'#1f5a8f',pats:[0,1,2,3,4,5,6,9,12]},\n{name:'Лазер',diff:4,speed:390,gap:[4.5,6],seed:45,count:80,col:'#0f6b4f',pats:[1,2,4,5,6,9,11,12,8]},\n{name:'Финал',diff:5,speed:420,gap:[4,5.5],seed:55,count:95,col:'#8f2a1f',pats:[2,5,6,7,8,9,10,11,12]},\n{name:'Хаос',diff:6,speed:450,gap:[3.5,5],seed:338,count:110,col:'#5a1f8f',pats:[5,6,7,8,10,11,12,9,2]},\n{name:'Невозможно',diff:7,speed:480,gap:[3,4.5],seed:83,count:130,col:'#2b2b2b',pats:[5,6,7,8,11,12,9]}];\nconst PATS=[[['s',0]],[['s',0],['s',1]],[['s',0],['s',1],['s',2]],[['b',0,1]],[['b',0,2]],[['b',0,2],['s',4]],[['s',0],['s',3]],[['s',0],['s',1],['s',2],['s',3]],[['b',0,1],['b',3,1]],[['s',0],['s',2]],[['s',0],['s',3],['s',6]],[['b',0,2],['s',3],['s',4],['b',5,2]],[['b',0,1],['s',1],['s',2],['b',3,1]]];\nfunction build(L){const r=rng(L.seed),o=[];let x=900;\n for(let i=0;i<L.count;i++){const p=PATS[L.pats[Math.floor(r()*L.pats.length)]];let w=0;\n  for(const q of p){const ww=q[0]==='b'?q[2]*S:S;o.push({t:q[0],x:x+q[1]*S,w:ww});w=Math.max(w,q[1]*S+ww)}\n  x+=w+(L.gap[0]+r()*(L.gap[1]-L.gap[0]))*S}\n return{obs:o,length:x}}\nfunction step(s,jump,spd,obs){let{cam,y,vy,g}=s;\n if(jump&&g){vy=-JUMP;g=false}\n cam+=spd*DT;vy+=GRAV*DT;let ny=y+vy*DT,land=false;const px=cam+PX,top=G-S;\n for(const o of obs){if(o.t!=='b'||o.x>px+S+10||o.x+o.w<px-10)continue;\n  if(px+S>o.x+4&&px<o.x+o.w-4&&y+S<=top+6&&ny+S>=top&&vy>=0){ny=top-S;land=true;vy=0}}\n if(ny>=G-S){ny=G-S;land=true;vy=0}\n for(const o of obs){if(o.x>px+S+10||o.x+o.w<px-10)continue;\n  if(o.t==='s'){const c=o.x+o.w/2,h=o.w/2-10;if(px+S-7>c-h&&px+7<c+h&&ny+S-7>G-S+10)return null}\n  else if(px+S-4>o.x&&px+4<o.x+o.w&&ny+S-4>top+8)return null}\n return{cam,y:ny,vy,g:land}}\nfunction sim(s,at,spd,obs,dep){for(let i=0;i<110;i++){s=step(s,i===at,spd,obs);if(!s)return false;if(at>=0&&i>at+2&&s.g)return dep<=0||after(s,spd,obs,dep-1)}return true}\nfunction after(s,spd,obs,dep){const px=s.cam+PX;if(!obs.some(o=>o.x+o.w>px-40&&o.x<px+300))return true;for(let k=0;k<=40;k+=2)if(sim(s,k,spd,obs,dep))return true;return false}\nfunction botJump(s,spd,all){if(!s.g)return false;const px=s.cam+PX,n=all.filter(o=>o.x>px-60&&o.x<px+1400);\n if(!n.some(o=>o.x<px+500))return false;\n return sim(s,0,spd,n,DEPTH)&&!sim(s,3,spd,n,DEPTH)}\n// LOGIC-END\nconst $=id=>document.getElementById(id),cv=$('c'),ctx=cv.getContext('2d');\nconst SKINS=[{n:'Классик',c:'#ffb703'},{n:'Лёд',c:'#4cc9f0'},{n:'Роза',c:'#ff70a6'},{n:'Лайм',c:'#9ef01a'},{n:'Фиолет',c:'#b388ff'},{n:'Ниндзя',c:'#2b2b2b'},{n:'Claude',c:'#d97757'}];\nconst NS=()=>save.egg?SKINS.length:SKINS.length-1;\nlet save={skin:0,lvl:0,best:{},bot:false,sfx:true,music:true,egg:false};\ntry{Object.assign(save,JSON.parse(localStorage.getItem('dc')||'{}'))}catch(e){}\nconst persist=()=>{try{localStorage.setItem('dc',JSON.stringify(save))}catch(e){}};\nlet ac=null,mt=null,ms=0;\nfunction A(){if(!ac){try{ac=new(window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(ac&&ac.state==='suspended')ac.resume();return ac}\nfunction tone(f,d,ty,v,t0,sl){const c=A();if(!c)return;const o=c.createOscillator(),g=c.createGain(),t=c.currentTime+(t0||0);o.type=ty;o.frequency.setValueAtTime(f,t);if(sl)o.frequency.exponentialRampToValueAtTime(sl,t+d);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+d)}\nfunction sfx(k){if(!save.sfx)return;if(k==='jump')tone(380,.14,'square',.04,0,760);else if(k==='die'){tone(180,.45,'sawtooth',.07,0,40);tone(90,.4,'square',.05,0,30)}else[523,659,784,1047].forEach((f,i)=>tone(f,.25,'triangle',.07,i*.12))}\nfunction music(on){clearInterval(mt);mt=null;if(on&&save.music&&A()){ms=0;mt=setInterval(()=>{const a=[220,262,330,262,196,247,294,247],i=ms++%8;tone(a[i]*2,.18,'triangle',.035);if(i%2===0)tone(a[i]/2,.3,'sine',.07)},214)}}\nlet mode='menu',s,lv,rot=0,holding=false,want=0,particles=[],shake=0,mcam=0;\nfunction show(id){document.querySelectorAll('.scr').forEach(e=>e.classList.toggle('on',e.id===id));$('menuBtn').classList.toggle('on',id===null)}\nfunction toMenu(id){music(false);mode='menu';show(id||'main')}\ndocument.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const g=b.dataset.go;if(g==='levels')renderCard();if(g==='garage')renderSkin();show(g)});\nconst TGN={bot:'Бот (авто-прохождение)',sfx:'Звук',music:'Музыка'};\nfunction renderTg(){document.querySelectorAll('[data-tg]').forEach(b=>b.textContent=TGN[b.dataset.tg]+': '+(save[b.dataset.tg]?'вкл':'выкл'))}\ndocument.querySelectorAll('[data-tg]').forEach(b=>b.onclick=()=>{const k=b.dataset.tg;save[k]=!save[k];persist();renderTg();if(k==='music'&&!save.music)music(false)});renderTg();\n$('reset').onclick=e=>{const b=e.target;if(b.dataset.c){save={skin:0,lvl:0,best:{},bot:false,sfx:save.sfx,music:save.music,egg:false};persist();renderTg();b.textContent='Сброшено';delete b.dataset.c}else{b.dataset.c=1;b.textContent='Точно сбросить?';setTimeout(()=>{b.textContent='Сбросить прогресс';delete b.dataset.c},3000)}};\nlet eg=0,egT;$('title').onclick=()=>{eg++;clearTimeout(egT);egT=setTimeout(()=>eg=0,1500);if(eg>=5){eg=0;save.egg=true;persist();sfx('win');show('egg')}};\n$('eggOk').onclick=()=>show('main');\nfunction renderCard(){const L=LEVELS[save.lvl];$('card').innerHTML='<b>'+L.name+'</b><p>'+'★'.repeat(Math.min(L.diff,5))+'☆'.repeat(Math.max(0,5-L.diff))+(L.diff>5?' 🔥'.repeat(L.diff-5):'')+'</p><p>Рекорд: '+(save.best[save.lvl]||0)+'%</p>'}\n$('lp').onclick=()=>{save.lvl=(save.lvl+LEVELS.length-1)%LEVELS.length;persist();renderCard()};\n$('ln').onclick=()=>{save.lvl=(save.lvl+1)%LEVELS.length;persist();renderCard()};\nfunction renderSkin(){const p=$('pv').getContext('2d');p.clearRect(0,0,120,120);cube(p,60,60,64,0,save.skin);$('skinName').textContent=SKINS[save.skin].n+' ('+(save.skin+1)+'/'+NS()+')'}\n$('gp').onclick=()=>{save.skin=(save.skin+NS()-1)%NS();persist();renderSkin()};\n$('gn').onclick=()=>{save.skin=(save.skin+1)%NS();persist();renderSkin()};\nfunction cube(c,x,y,z,r,k){c.save();c.translate(x,y);c.rotate(r);const h=z/2,u=z/40;\n c.fillStyle=SKINS[k].c;c.fillRect(-h,-h,z,z);c.strokeStyle='#fff4d6';c.lineWidth=3*u;c.strokeRect(-h+1.5*u,-h+1.5*u,z-3*u,z-3*u);\n c.fillStyle=k===5?'#ff4d6d':'#1b1140';c.strokeStyle='#1b1140';c.lineWidth=4*u;\n if(k===0||k===5){c.fillRect(-9*u,-8*u,6*u,10*u);c.fillRect(5*u,-8*u,6*u,10*u)}\n else if(k===1){c.fillRect(-14*u,-8*u,28*u,8*u)}\n else if(k===2){c.fillRect(-10*u,-8*u,6*u,6*u);c.fillRect(5*u,-8*u,6*u,6*u);c.beginPath();c.arc(0,4*u,8*u,.1*Math.PI,.9*Math.PI);c.stroke()}\n else if(k===3){c.beginPath();c.moveTo(-14*u,14*u);c.lineTo(14*u,-14*u);c.stroke()}\n else if(k===6){c.lineWidth=5*u;for(let a=0;a<4;a++){const x=Math.cos(a*Math.PI/4)*13*u,y=Math.sin(a*Math.PI/4)*13*u;c.beginPath();c.moveTo(-x,-y);c.lineTo(x,y);c.stroke()}}\n else{c.fillRect(-3*u,-12*u,6*u,24*u);c.fillRect(-12*u,-3*u,24*u,6*u)}\n c.restore()}\nfunction start(){lv=LEVELS[save.lvl];lv.data=build(lv);s={cam:0,y:G-S,vy:0,g:true};rot=0;particles=[];holding=false;mode='play';show(null);music(true);$('menuBtn').classList.add('on')}\n$('playBtn').onclick=start;$('retry').onclick=start;$('toMenu').onclick=()=>toMenu('levels');$('menuBtn').onclick=e=>{e.stopPropagation();toMenu('levels')};\nconst prog=()=>Math.min(100,Math.floor(s.cam/(lv.data.length-500)*100));\nfunction finish(win){music(false);sfx(win?'win':'die');const p=win?100:prog();if(p>(save.best[save.lvl]||0)){save.best[save.lvl]=p;persist()}\n $('endT').textContent=win?'Уровень пройден!':'Разбился!';$('endP').textContent=(win?'':'Прогресс: '+p+'%. ')+(save.bot?'Играл бот.':'Рекорд: '+save.best[save.lvl]+'%');\n $('menuBtn').classList.remove('on');setTimeout(()=>{if(mode==='over')show('end')},win?300:700)}\nfunction die(){mode='over';shake=14;for(let i=0;i<30;i++)particles.push({x:PX+S/2,y:s.y+S/2,vx:(Math.random()-.5)*600,vy:(Math.random()-.7)*600,l:1});finish(false)}\nfunction tick(){\n particles.forEach(q=>{q.x+=q.vx*DT;q.y+=q.vy*DT;q.vy+=GRAV*DT*.6;q.l-=DT});particles=particles.filter(q=>q.l>0);\n if(mode==='menu'){mcam+=150*DT;return}if(mode!=='play')return;\n const jump=save.bot?botJump(s,lv.speed,lv.data.obs):want>0;if(want>0)want--;\n if(jump&&s.g){sfx('jump');want=0}const n=step(s,jump,lv.speed,lv.data.obs);if(!n)return die();\n if(!n.g)rot+=DT*Math.PI*1.6;else rot=Math.round(rot/(Math.PI/2))*(Math.PI/2);\n s=n;if(s.cam>=lv.data.length-500){mode='over';finish(true)}}\nfunction press(e){if(mode==='play'&&!save.bot)want=6}\ncv.addEventListener('pointerdown',press);addEventListener('pointerup',()=>holding=false);\naddEventListener('keydown',e=>{if(['Space','ArrowUp','KeyW'].includes(e.code)){if(mode==='play'){e.preventDefault();if(!e.repeat)want=6}}\n if(e.code==='Escape'&&mode==='play')toMenu('levels')});\naddEventListener('keyup',e=>{if(['Space','ArrowUp','KeyW'].includes(e.code))holding=false});\nfunction draw(){const L=mode==='menu'?LEVELS[save.lvl]:lv,cam=mode==='menu'?mcam:s.cam;\n ctx.save();if(shake>0){ctx.translate((Math.random()-.5)*shake*2,(Math.random()-.5)*shake*2);shake*=.88;if(shake<.5)shake=0}\n const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,L.col);g.addColorStop(1,'#1b1140');ctx.fillStyle=g;ctx.fillRect(-20,-20,W+40,H+40);\n ctx.fillStyle='rgba(255,255,255,.05)';const off=(cam*.3)%120;for(let x=-off;x<W;x+=120)ctx.fillRect(x,0,50,G);\n ctx.fillStyle='#120a2e';ctx.fillRect(-20,G,W+40,H-G+20);ctx.fillStyle='#ffb703';ctx.fillRect(-20,G,W+40,4);\n ctx.fillStyle='rgba(255,183,3,.25)';const go=cam%S;for(let x=-go;x<W;x+=S)ctx.fillRect(x,G+14,S/2,3);\n if(mode!=='menu'){for(const o of lv.data.obs){const x=o.x-cam;if(x>W+50||x+o.w<-50)continue;\n  if(o.t==='s'){ctx.fillStyle='#ff4d6d';ctx.beginPath();ctx.moveTo(x,G);ctx.lineTo(x+o.w/2,G-S+2);ctx.lineTo(x+o.w,G);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff4d6';ctx.lineWidth=2;ctx.stroke()}\n  else{ctx.fillStyle='#3a86ff';ctx.fillRect(x,G-S,o.w,S);ctx.strokeStyle='#fff4d6';ctx.lineWidth=2;ctx.strokeRect(x+1,G-S+1,o.w-2,S-2)}}\n  if(mode==='play')cube(ctx,PX+S/2,s.y+S/2,S,rot,save.skin);\n  const p=mode==='play'||mode==='over'?prog():0;ctx.fillStyle='rgba(255,244,214,.25)';ctx.fillRect(250,16,400,10);ctx.fillStyle='#ffb703';ctx.fillRect(250,16,4*p,10);\n  ctx.fillStyle='#fff4d6';ctx.font='bold 18px Trebuchet MS,sans-serif';ctx.textAlign='left';ctx.fillText(p+'%',660,27);\n  if(save.bot){ctx.textAlign='right';ctx.fillText('БОТ',W-20,27)}}\n else cube(ctx,PX+S/2,G-S/2,S,0,save.skin);\n particles.forEach(q=>{ctx.globalAlpha=Math.max(q.l,0);ctx.fillStyle=SKINS[save.skin].c;ctx.fillRect(q.x,q.y,8,8)});ctx.globalAlpha=1;ctx.restore()}\nlet acc=0,last=performance.now();\nfunction loop(t){acc+=Math.min((t-last)/1000,.1);last=t;while(acc>=DT){tick();acc-=DT}draw();requestAnimationFrame(loop)}\nrequestAnimationFrame(loop);\n</script><div id=\"offline-bar\" style=\"position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99;pointer-events:none;background:rgba(0,0,0,.7);color:#fff4d6;font:13px 'Trebuchet MS',Verdana,sans-serif;padding:7px 16px;border-radius:999px;white-space:nowrap\">Нет сети · <span id=\"off-time\">0:00</span> · страница откроется сама, как только интернет вернётся</div>\n<script>\n(function () {\n  var t0 = Date.now(), startedOffline = !navigator.onLine;\n  function go() { try { parent.postMessage({ vitreumGo: true }, '*'); } catch (e) {} }\n  window.addEventListener('online', go);\n  setInterval(function () {\n    var s = Math.floor((Date.now() - t0) / 1000);\n    var el = document.getElementById('off-time'); if (el) el.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);\n    if (startedOffline ? navigator.onLine : (s > 0 && s % 8 === 0)) go();\n  }, 1000);\n})();\n</script>\n</body></html>";

const CHROME_MAJOR = String(process.versions.chrome || '120').split('.')[0];
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const CH_UA = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not?A_Brand";v="99"`;
// Google пускает вход не из всех встроенных браузеров, поэтому на странице входа представляемся Firefox
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
let region = { lang: 'ru-RU' };
const knownSessions = [];
function acceptLangHeader(lang) { return `${lang},${lang.split('-')[0]};q=0.9,en-US;q=0.8,en;q=0.7`; }
function applyRegionToSessions() {
  knownSessions.forEach(ses => { try { ses.setUserAgent(CHROME_UA, acceptLangHeader(region.lang)); } catch (e) {} });
}

// Загрузки как в Chrome: без окна Windows, файл сразу идёт в «Загрузки», прогресс виден в панели
function attachDownloadHandler(ses) {
  ses.on('will-download', (event, item) => {
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const id = 'dl-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const downloadsPath = app.getPath('downloads');

    let savePath = path.join(downloadsPath, fileName);
    let counter = 1;
    while (fs.existsSync(savePath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      savePath = path.join(downloadsPath, `${base} (${counter})${ext}`);
      counter++;
    }
    // Путь задаём сразу: так окно «Сохранить как» не появляется
    item.setSavePath(savePath);
    activeDownloads++;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-started', { id, fileName, totalBytes, savePath });
      fileIconDataUrl(savePath).then((icon) => { if (icon && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-icon', { id, icon }); });
    }
    let lastT = Date.now(), lastB = 0, speed = 0;
    item.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const receivedBytes = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const percent = total > 0 ? Math.round((receivedBytes / total) * 100) : 0;
        const now = Date.now(), dt = (now - lastT) / 1000;
        if (dt >= 0.5) { const inst = (receivedBytes - lastB) / dt; speed = speed ? speed * 0.6 + inst * 0.4 : inst; lastT = now; lastB = receivedBytes; }
        const eta = speed > 0 && total > 0 ? Math.round((total - receivedBytes) / speed) : -1;
        mainWindow.webContents.send('download-progress', { id, fileName, percent, receivedBytes, totalBytes: total, speed, eta });
      }
    });
    item.once('done', (evt, state) => {
      activeDownloads = Math.max(0, activeDownloads - 1);
      if (state === 'completed' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-completed', { id, fileName, savePath });
        // у готового файла значок настоящий (у установщика это значок самой программы)
        fileIconDataUrl(savePath).then((icon) => { if (icon && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-icon', { id, icon }); });
      }
    });
  });
}

// Всё, что нужно сессии сайтов (вкладки, ИИ-панель): загрузки, язык региона, нормальный User-Agent
const readySessions = new WeakSet();
function setupWebviewSession(ses) {
  if (readySessions.has(ses)) return;
  readySessions.add(ses);
  knownSessions.push(ses);
  attachDownloadHandler(ses);
  if (ses === session.fromPartition('persist:vitreum') && !blocker) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const block = adBlockEnabled && details.resourceType !== 'mainFrame' && adDomains.some((d) => details.url.includes(d));
      callback({ cancel: block });
    });
  }
  if (vpnActive) ses.setProxy({ proxyRules: 'socks5://127.0.0.1:' + VPN_PORT, proxyBypassRules: '<local>' }).catch(() => {});
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const hd = details.requestHeaders;
    hd['Accept-Language'] = acceptLangHeader(region.lang);
    if (flags.dnt) { hd['DNT'] = '1'; hd['Sec-GPC'] = '1'; }
    let host = ''; try { host = new URL(details.url).hostname; } catch (err) {}
    if (host === 'accounts.google.com') {
      hd['User-Agent'] = FIREFOX_UA;
      for (const k of Object.keys(hd)) if (k.toLowerCase().startsWith('sec-ch-ua')) delete hd[k];
    } else {
      hd['sec-ch-ua'] = CH_UA; hd['sec-ch-ua-mobile'] = '?0'; hd['sec-ch-ua-platform'] = '"Windows"';
    }
    cb({ requestHeaders: hd });
  });
  ses.setUserAgent(CHROME_UA, acceptLangHeader(region.lang));
}

const adDomains = [
  'doubleclick.net', 'googlesyndication.com', 'an.yandex.ru', 
  'adservice.google.com', 'analytics.google.com', 'mc.yandex.ru',
  'pagead2.googlesyndication.com', 'ad.mail.ru', 'ads.vk.com',
  'adfox.ru', 'googleadservices.com'
];
adDomains.push('doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.', 'pagead2.', 'amazon-adsystem.com', 'adnxs.com', 'criteo.', 'taboola.com', 'outbrain.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'moatads.com', 'adsrvr.org', 'smartadserver.com', '2mdn.net', 'an.yandex.ru', 'yabs.yandex.ru', 'yandexadexchange.net', 'awaps.yandex.net', 'adfox.yandex.ru', 'ads.adfox.ru', 'yandex.ru/ads', 'yastatic.net/pcode', 'mc.yandex.ru', 'ad.mail.ru', 'ads.vk.com', 'adriver.ru', 'begun.ru', 'relap.io', 'popads.net', 'propellerads.com', 'onclickads.net', 'adsterra.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, frame: false, backgroundColor: '#05040a', show: false,
    title: "Vitreum Ultimate Browser",
    icon: fs.existsSync(path.join(__dirname, 'build', 'icon.ico')) ? path.join(__dirname, 'build', 'icon.ico') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, webviewTag: true, webSecurity: false, plugins: true
    }
  });

  const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const filter = { urls: ['<all_urls>'] };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url.startsWith('http')) {
      if (!url.match(/\.(zip|exe|rar|7z|msi|iso|dmg|tar|gz|apk|deb|rpm)$/i)) {
        mainWindow.webContents.send('open-in-new-tab', url);
      }
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('context-menu', (e, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (params.isEditable || params.selectionText.length > 0 || params.linkURL || params.srcURL) {
      mainWindow.webContents.send('show-context-menu', {
        x: params.x, y: params.y, isEditable: params.isEditable,
        selectionText: params.selectionText, linkURL: params.linkURL, srcURL: params.srcURL,
        webContentsId: mainWindow.webContents.id, isMainWindow: true
      });
    } else {
      mainWindow.webContents.send('hide-context-menu');
    }
  });

  mainWindow.webContents.session.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (!adBlockEnabled) { callback({ cancel: false }); return; }
    const shouldBlock = adDomains.some(domain => details.url.includes(domain));
    callback({ cancel: shouldBlock });
  });

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders['User-Agent'] = chromeUserAgent;
    details.requestHeaders['Accept-Language'] = acceptLangHeader(region.lang);
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    delete responseHeaders['x-frame-options']; delete responseHeaders['X-Frame-Options'];
    delete responseHeaders['content-security-policy']; delete responseHeaders['Content-Security-Policy'];
    callback({ cancel: false, responseHeaders });
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => callback(permissionAllowed(permission)));

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  attachShortcuts(mainWindow.webContents);
  mainWindow.setMenuBarVisibility(false);
  // Если идёт загрузка, при закрытии спрашиваем: выйти или остаться
  mainWindow.on('close', (e) => {
    if (forceClose || activeDownloads <= 0 || !flags.confirmExit) return;
    e.preventDefault();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('confirm-exit', activeDownloads);
  });
  mainWindow.webContents.on('render-process-gone', () => { try { mainWindow.reload(); } catch (err) {} });
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    let crashTimes = [];
    contents.on('render-process-gone', (e, details) => {
      console.error('Вкладка упала:', details.reason, 'код', details.exitCode);
      if (details.reason === 'clean-exit') return;
      const now = Date.now(); crashTimes = crashTimes.filter((t) => now - t < 60000); crashTimes.push(now);
      if (crashTimes.length <= 2) setTimeout(() => { try { if (!contents.isDestroyed()) contents.reload(); } catch (err) {} }, 500);
    });
    contents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      try { contents.setUserAgent(new URL(url).hostname === 'accounts.google.com' ? FIREFOX_UA : CHROME_UA); } catch (err) {}
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(accounts\.google\.com|id\.vk\.com|oauth\.vk\.com|login\.vk\.com)\//.test(url || '')) return { action: 'allow' };
      if (flags.blockPopups) return { action: 'deny' };
      if (url && url.startsWith('http') && mainWindow) {
        if (!url.match(/\.(zip|exe|rar|7z|msi|iso|dmg|tar|gz|apk|deb|rpm)$/i)) mainWindow.webContents.send('open-in-new-tab', url);
      }
      return { action: 'deny' };
    });

    contents.session.setPermissionRequestHandler((webContents, permission, callback) => callback(permissionAllowed(permission)));
    setupWebviewSession(contents.session);

    contents.on('context-menu', (e, params) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // На страницах сайтов меню открывается в любом месте
      mainWindow.webContents.send('show-context-menu', {
        x: params.x, y: params.y, isEditable: params.isEditable,
        selectionText: params.selectionText || '', linkURL: params.linkURL, srcURL: params.srcURL,
        webContentsId: contents.id, isMainWindow: false
      });
    });

    attachShortcuts(contents);
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'mouseDown' && mainWindow) mainWindow.webContents.send('hide-context-menu');
    });
  }
});

// Горячие клавиши работают и когда фокус внутри сайта
function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  if (input.key === 'F5') return 'reload';
  if (input.key === 'F11') return 'fullscreen';
  if (!(input.control || input.meta) || input.alt) return null;
  const k = (input.key || '').toLowerCase();
  if (k === 't') return input.shift ? 'reopen-tab' : 'new-tab';
  if (k === 'w') return 'close-tab';
  if (k === 'l') return 'focus-address';
  if (k === 'f') return 'find';
  if (k === 'r') return input.shift ? 'hard-reload' : 'reload';
  if (k === 'd') return 'bookmark';
  if (k === 's') return input.shift ? 'screenshot' : 'save-pdf';
  if (k === 'p') return 'print';
  if (k === 'tab') return input.shift ? 'prev-tab' : 'next-tab';
  if (k === '=' || k === '+') return 'zoom-in';
  if (k === '-' || k === '_') return 'zoom-out';
  if (k === '0') return 'zoom-reset';
  return null;
}
function attachShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    const name = shortcutFor(input);
    if (!name || !mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    if (name === 'fullscreen') { mainWindow.setFullScreen(!mainWindow.isFullScreen()); return; }
    mainWindow.webContents.send('shortcut', name);
  });
}

ipcMain.on('toggle-adblock', (e, status) => {
  adBlockEnabled = status;
  if (blocker) {
    const ses = session.fromPartition('persist:vitreum');
    try { if (status) blocker.enableBlockingInSession(ses); else blocker.disableBlockingInSession(ses); } catch (err) {}
  }
});
ipcMain.on('set-flags', (e, f) => {
  if (!f || typeof f !== 'object') return;
  for (const k of Object.keys(flags)) if (typeof f[k] === 'boolean') flags[k] = f[k];
});
ipcMain.handle('open-downloads', async () => !(await shell.openPath(app.getPath('downloads'))));
ipcMain.handle('get-about', async () => ({ app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }));

async function initAdBlocker() {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const b = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: path.join(app.getPath('userData'), 'adblock-engine.bin'),
      read: fs.promises.readFile,
      write: fs.promises.writeFile
    });
    if (adBlockEnabled) b.enableBlockingInSession(session.fromPartition('persist:vitreum'));
    blocker = b;
  } catch (err) {
    blocker = null;
    console.error('Блокировщик со списками не запустился, работает простой список:', err && err.message);
  }
}

ipcMain.on('perform-edit-action', (e, { action, webContentsId, selectionText }) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) return;

    // Копировать и вырезать: текст берём из выделения, которое пришло вместе с кликом.
    // Это кладёт его в системный буфер напрямую и не зависит от того, где сейчас фокус.
    if ((action === 'copy' || action === 'cut') && selectionText) {
      clipboard.writeText(selectionText);
    }

    // Возвращаем фокус странице (после клика по нашему меню он ушёл в главное окно)
    // и даём ему время примениться, иначе команда уходит "в пустоту".
    wc.focus();
    setTimeout(() => {
      try {
        if (wc.isDestroyed()) return;
        switch (action) {
          case 'undo': wc.undo(); break;
          case 'redo': wc.redo(); break;
          case 'cut': wc.cut(); break;
          case 'copy': if (!selectionText) wc.copy(); break;
          case 'paste': wc.paste(); break;
          case 'selectAll': wc.selectAll(); break;
        }
      } catch (err) { console.error('Edit action error:', err); }
    }, 60);
  } catch (err) { console.error('Edit action error:', err); }
});

ipcMain.on('copy-link-address', (e, linkURL) => { if (linkURL) clipboard.writeText(linkURL); });

ipcMain.on('inspect-element', (e, { webContentsId, x, y }) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      wc.inspectElement(Math.round(x), Math.round(y));
      if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
    }
  } catch (err) { console.error(err); }
});

ipcMain.on('download-url', (e, payload) => {
  const url = typeof payload === 'string' ? payload : payload && payload.url;
  if (!url) return;
  let wc = null;
  if (payload && payload.webContentsId) { try { wc = webContents.fromId(payload.webContentsId); } catch (err) {} }
  if (!wc || wc.isDestroyed()) wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (wc) wc.downloadURL(url);
});

ipcMain.on('get-offline-url', (e) => {
  try {
    const file = path.join(app.getPath('userData'), 'offline.html');
    fs.writeFileSync(file, OFFLINE_HTML, 'utf8');
    e.returnValue = require('url').pathToFileURL(file).href;
  } catch (err) { e.returnValue = ''; }
});

ipcMain.handle('google-signed-in', async () => {
  try { const c = await session.fromPartition('persist:vitreum').cookies.get({ name: 'SAPISID' }); return c.length > 0; } catch (err) { return false; }
});
ipcMain.handle('clear-site-data', async () => {
  try {
    for (const name of ['persist:vitreum', 'persist:ai-session', 'persist:vk-session']) { const ses = session.fromPartition(name); await ses.clearCache(); await ses.clearStorageData(); }
    return true;
  } catch (err) { return false; }
});

ipcMain.handle('save-page', async (e, { webContentsId, kind }) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) return { ok: false };
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const base = (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'page';
    let file;
    if (kind === 'pdf') { file = path.join(app.getPath('downloads'), base + ' ' + stamp + '.pdf'); fs.writeFileSync(file, await wc.printToPDF({ printBackground: true })); }
    else { file = path.join(app.getPath('downloads'), base + ' ' + stamp + '.png'); fs.writeFileSync(file, (await wc.capturePage()).toPNG()); }
    return { ok: true, file: path.basename(file) };
  } catch (err) { return { ok: false }; }
});

ipcMain.handle('open-file', async (e, p) => {
  try {
    const abs = path.resolve(String(p));
    // открываем только файлы из папки «Загрузки»
    if (path.dirname(abs) !== path.resolve(app.getPath('downloads'))) return false;
    return !(await shell.openPath(abs));
  } catch (err) { return false; }
});

ipcMain.handle('get-default-sub', async () => {
  try {
    for (const f of [path.join(__dirname, 'subscription.txt'), path.join(process.resourcesPath || '', 'subscription.txt'), path.join(path.dirname(app.getPath('exe')), 'subscription.txt')]) {
      if (fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8').trim(); if (/^https?:\/\//.test(t)) return t; }
    }
  } catch (err) {}
  return '';
});

ipcMain.handle('get-gfx-compat', async () => fs.existsSync(GFX_FLAG));
ipcMain.on('set-gfx-compat', (e, on) => {
  try {
    if (on) { fs.mkdirSync(path.dirname(GFX_FLAG), { recursive: true }); fs.writeFileSync(GFX_FLAG, '1'); }
    else if (fs.existsSync(GFX_FLAG)) fs.unlinkSync(GFX_FLAG);
  } catch (err) {}
  app.relaunch(); app.exit(0);
});

ipcMain.on('confirm-exit-yes', () => { forceClose = true; app.quit(); });

ipcMain.handle('get-offline-html', async () => OFFLINE_HTML);

ipcMain.on('copy-image', (e, { webContentsId, x, y }) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) wc.copyImageAt(Math.round(x), Math.round(y));
  } catch (err) { console.error(err); }
});

ipcMain.on('set-region', (e, r) => {
  if (r && typeof r.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(r.lang)) {
    region = { lang: r.lang };
    applyRegionToSessions();
  }
});

function fetchUrl(url, opts = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': opts.ua || 'Mozilla/5.0', 'Accept': '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).href, opts, redirects + 1));
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = ''; res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(opts.timeout || 15000, () => req.destroy(new Error('Таймаут')));
    req.on('error', reject);
  });
}

// Подписка может быть: список ссылок (vless://, vmess://...), он же в base64, или JSON-конфиги Xray
function parseSubText(rawData) {
  let text = String(rawData).trim();
  if (!/^[\[{]/.test(text) && !text.includes('://')) { try { const d = b64d(text.replace(/\s+/g, '')).trim(); if (d) text = d; } catch (err) {} }
  const servers = [];
  if (/^[\[{]/.test(text)) {
    let j = null; try { j = JSON.parse(text); } catch (err) {}
    if (j) {
      (Array.isArray(j) ? j : [j]).forEach((e, i) => {
        const outs = Array.isArray(e && e.outbounds) ? e.outbounds : [];
        const mainOut = outs.find(o => o.tag === 'proxy') || outs.find(o => o.protocol && !['freedom', 'blackhole', 'dns', 'loopback'].includes(o.protocol)) || outs[0];
        if (!mainOut) return;
        servers.push({ id: servers.length, name: e.remarks || e.remark || e.name || mainOut.tag || ('Server ' + (i + 1)), type: String(mainOut.protocol || '?').toUpperCase(), raw: JSON.stringify(e), mainOut });
      });
      return servers;
    }
  }
  text.split(/\r?\n/).forEach((line, index) => {
    line = line.trim(); if (!line) return;
    const tag = line.includes('#') ? decodeURIComponent(line.split('#')[1] || '') : '';
    let name = tag || `Server ${index + 1}`, type;
    if (line.startsWith('vless://')) type = 'VLESS';
    else if (line.startsWith('vmess://')) { type = 'VMess'; try { name = JSON.parse(b64d(line.slice(8))).ps || name; } catch (err) {} }
    else if (line.startsWith('trojan://')) type = 'Trojan';
    else if (line.startsWith('ss://')) type = 'Shadowsocks';
    else if (line.startsWith('hysteria://') || line.startsWith('hysteria2://') || line.startsWith('hy2://')) type = 'Hysteria';
    else return;
    servers.push({ id: servers.length, name, type, raw: line });
  });
  return servers;
}

async function loadSubscription(subUrl) {
  // Некоторые панели отдают разный формат разным программам, поэтому пробуем несколько
  let lastErr = null;
  for (const ua of ['v2rayN/7.0.0', 'Happ/2.0.0', 'INCY/3.9.7', 'Mozilla/5.0']) {
    try { const list = parseSubText(await fetchUrl(subUrl, { ua })); if (list.length) return list; } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('В подписке не найдено серверов');
}

function outboundEndpoint(o) {
  const st = (o && o.settings) || {};
  const v = (st.vnext && st.vnext[0]) || (st.servers && st.servers[0]) || st;
  return v && v.address && v.port ? { host: v.address, port: +v.port } : null;
}

ipcMain.handle('vpn-parse-sub', async (e, subUrl) => {
  try {
    subUrl = String(subUrl).trim();
    const servers = /^https?:\/\//.test(subUrl) ? await loadSubscription(subUrl) : parseSubText(subUrl.replace(/^incy:\/\//, ''));
    if (!servers.length) return { success: false, error: 'В подписке не найдено серверов' };
    await Promise.all(servers.map(async (sv) => {
      try {
        let ep, udp = false;
        if (sv.mainOut) { ep = outboundEndpoint(sv.mainOut); udp = !!(sv.mainOut.streamSettings && sv.mainOut.streamSettings.network === 'hysteria'); }
        else ep = parseLink(sv.raw);
        if (udp) { sv.ping = 'UDP'; return; }
        if (!ep) { sv.ping = '—'; return; }
        const ms = await tcpPing(ep.host, ep.port); sv.ping = ms == null ? 'нет ответа' : ms + ' ms';
      } catch (err) { sv.ping = 'не поддерживается'; }
    }));
    servers.forEach((sv) => delete sv.mainOut);
    return { success: true, servers };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ================= VPN: встроенное ядро Xray =================
const cp = require('child_process');
const netMod = require('net');
const VPN_PORT = 10808;
let xrayProc = null, xrayLog = '', vpnActive = false;

function findXray() {
  const exeName = process.platform === 'win32' ? 'xray.exe' : 'xray';
  const dirs = [path.join(process.resourcesPath || '', 'bin'), path.join(__dirname, 'bin'), path.join(path.dirname(app.getPath('exe')), 'bin')];
  for (const d of dirs) { const f = path.join(d, exeName); if (fs.existsSync(f)) return f; }
  return null;
}
const b64d = (x) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function buildStream(p, host, defSecurity) {
  let network = p.get('type') || 'tcp'; if (network === 'h2') network = 'http';
  const security = p.get('security') || defSecurity || 'none';
  const st = { network, security };
  const sni = p.get('sni') || p.get('host') || host;
  if (security === 'tls') st.tlsSettings = { serverName: sni, fingerprint: p.get('fp') || 'chrome', allowInsecure: p.get('allowInsecure') === '1' || p.get('insecure') === '1', ...(p.get('alpn') ? { alpn: p.get('alpn').split(',') } : {}) };
  if (security === 'reality') st.realitySettings = { serverName: sni, fingerprint: p.get('fp') || 'chrome', publicKey: p.get('pbk') || '', shortId: p.get('sid') || '', spiderX: p.get('spx') || '' };
  const pth = p.get('path') || '/', hostH = p.get('host') || '';
  if (network === 'ws') st.wsSettings = { path: pth, headers: hostH ? { Host: hostH } : {} };
  else if (network === 'grpc') st.grpcSettings = { serviceName: p.get('serviceName') || '', multiMode: p.get('mode') === 'multi' };
  else if (network === 'httpupgrade') st.httpupgradeSettings = { path: pth, host: hostH };
  else if (network === 'xhttp' || network === 'splithttp') st[network + 'Settings'] = { path: pth, host: hostH, mode: p.get('mode') || 'auto' };
  else if (network === 'http') st.httpSettings = { path: pth, host: hostH ? [hostH] : [] };
  else if (network === 'tcp' && p.get('headerType') === 'http') st.tcpSettings = { header: { type: 'http', request: { path: [pth], headers: { Host: hostH ? [hostH] : [] } } } };
  return st;
}

// Ссылка подписки (vless / vmess / trojan / ss) -> исходящее подключение Xray
function parseLink(link) {
  link = link.trim();
  if (link.startsWith('vless://') || link.startsWith('trojan://')) {
    const isVless = link.startsWith('vless://');
    const u = new URL(link), host = u.hostname.replace(/^\[|\]$/g, ''), port = +u.port || 443, p = u.searchParams;
    if (isVless) return { host, port, outbound: { protocol: 'vless', settings: { vnext: [{ address: host, port, users: [{ id: decodeURIComponent(u.username), encryption: p.get('encryption') || 'none', ...(p.get('flow') ? { flow: p.get('flow') } : {}) }] }] }, streamSettings: buildStream(p, host, 'none') } };
    return { host, port, outbound: { protocol: 'trojan', settings: { servers: [{ address: host, port, password: decodeURIComponent(u.username) }] }, streamSettings: buildStream(p, host, 'tls') } };
  }
  if (link.startsWith('vmess://')) {
    const j = JSON.parse(b64d(link.slice(8).split('#')[0]));
    const p = new URLSearchParams({ type: j.net || 'tcp', security: j.tls === 'tls' ? 'tls' : 'none', sni: j.sni || '', host: j.host || '', path: j.path || '/', fp: j.fp || '', alpn: j.alpn || '', headerType: j.type || '', serviceName: j.path || '' });
    const host = j.add, port = +j.port;
    return { host, port, outbound: { protocol: 'vmess', settings: { vnext: [{ address: host, port, users: [{ id: j.id, alterId: +j.aid || 0, security: j.scy || 'auto' }] }] }, streamSettings: buildStream(p, host, 'none') } };
  }
  if (link.startsWith('ss://')) {
    const body = link.slice(5).split('#')[0].split('?')[0].replace(/\/$/, '');
    let info, hp;
    if (body.includes('@')) { const at = body.lastIndexOf('@'); info = decodeURIComponent(body.slice(0, at)); if (!info.includes(':')) info = b64d(info); hp = body.slice(at + 1); }
    else { const dec = b64d(body), at = dec.lastIndexOf('@'); info = dec.slice(0, at); hp = dec.slice(at + 1); }
    const ci = info.indexOf(':'), m = hp.match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (ci < 0 || !m) throw new Error('Не удалось разобрать ссылку Shadowsocks');
    const host = m[1], port = +m[2];
    return { host, port, outbound: { protocol: 'shadowsocks', settings: { servers: [{ address: host, port, method: info.slice(0, ci), password: info.slice(ci + 1) }] } } };
  }
  throw new Error('Протокол ' + link.split('://')[0] + ' встроенное ядро не поддерживает');
}

function tcpPing(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const t0 = Date.now(), sock = netMod.connect({ host, port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeout, () => done(null));
    sock.on('connect', () => done(Date.now() - t0));
    sock.on('error', () => done(null));
  });
}

async function vpnSelfTest() {
  const ses = session.fromPartition('persist:vitreum');
  const urls = ['https://www.gstatic.com/generate_204', 'https://cp.cloudflare.com/generate_204', 'https://www.google.com/generate_204'];
  const tests = urls.map((u) => ses.fetch(u).then((r) => { if (r.status === 204 || r.ok) return true; throw new Error('bad'); }));
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
  try { await Promise.race([Promise.any(tests), timeout]); return true; } catch (err) { return false; }
}
function stopXray() { if (xrayProc) { try { xrayProc.kill(); } catch (err) {} xrayProc = null; } }
async function setVpnProxy(on) {
  const cfg = on ? { proxyRules: 'socks5://127.0.0.1:' + VPN_PORT, proxyBypassRules: '<local>' } : { proxyRules: '' };
  for (const ses of new Set([session.defaultSession, ...knownSessions])) { try { await ses.setProxy(cfg); } catch (err) {} }
}

ipcMain.handle('vpn-connect', async (e, server) => {
  try {
    const exe = findXray();
    if (!exe) return { success: false, error: 'Не найден xray.exe. Скачайте Xray-windows-64.zip (github.com/XTLS/Xray-core/releases) и положите xray.exe, geoip.dat и geosite.dat в папку bin рядом с main.js' };
    vpnActive = false; stopXray(); await setVpnProxy(false);
    const inbounds = [{ tag: 'socks-in', listen: '127.0.0.1', port: VPN_PORT, protocol: 'socks', settings: { udp: true, auth: 'noauth' }, sniffing: { enabled: true, destOverride: ['http', 'tls'] } }];
    let config;
    if (String(server.raw).trim().startsWith('{')) {
      config = JSON.parse(server.raw);
      delete config.remarks;
      config.inbounds = inbounds;
      config.log = { loglevel: 'warning' };
    } else {
      const { outbound } = parseLink(server.raw);
      outbound.tag = 'proxy';
      config = {
        log: { loglevel: 'warning' },
        inbounds,
        outbounds: [outbound, { tag: 'direct', protocol: 'freedom' }],
        routing: { domainStrategy: 'IPIfNonMatch', rules: [{ type: 'field', ip: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'], outboundTag: 'direct' }] }
      };
    }
    const cfgPath = path.join(app.getPath('userData'), 'xray-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
    xrayLog = '';
    let exited = false;
    const proc = cp.spawn(exe, ['run', '-c', cfgPath], { cwd: path.dirname(exe), windowsHide: true });
    xrayProc = proc;
    const onData = (d) => { xrayLog = (xrayLog + d.toString()).slice(-2000); };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('error', (err) => { xrayLog += err.message; exited = true; });
    proc.on('exit', () => {
      exited = true;
      if (xrayProc === proc) xrayProc = null;
      if (vpnActive) { vpnActive = false; setVpnProxy(false); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vpn-dropped'); }
    });
    // ждём, пока ядро откроет локальный порт
    const ok = await new Promise((resolve) => {
      const t0 = Date.now();
      (function probe() {
        if (exited) return resolve(false);
        const sk = netMod.connect(VPN_PORT, '127.0.0.1');
        sk.on('connect', () => { sk.destroy(); resolve(true); });
        sk.on('error', () => { sk.destroy(); if (Date.now() - t0 > 6000) resolve(false); else setTimeout(probe, 200); });
      })();
    });
    if (!ok) { const msg = xrayLog.trim().split('\n').slice(-3).join(' | '); stopXray(); return { success: false, error: 'Ядро не запустилось: ' + (msg || 'нет ответа') }; }
    vpnActive = true;
    await setVpnProxy(true);
    if (!(await vpnSelfTest())) {
      vpnActive = false; await setVpnProxy(false);
      const tail = xrayLog.trim().split('\n').slice(-2).join(' | ');
      stopXray();
      return { success: false, error: 'Сервер запустился, но интернет через него не идёт. Выберите другой сервер.' + (tail ? ' Журнал ядра: ' + tail : '') };
    }
    return { success: true, serverName: server.name };
  } catch (err) {
    stopXray();
    return { success: false, error: err.message };
  }
});

ipcMain.handle('vpn-disconnect', async () => {
  try {
    vpnActive = false;
    await setVpnProxy(false);
    stopXray();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ================= Удалённое управление через файл на GitHub =================
// Файл remote.json лежит в вашем публичном репозитории. Браузер только читает его и
// умеет три безопасные вещи: показать обновление, показать сообщение, отключиться.
// Выполнять произвольные команды на компьютере он не может.
// Вставьте сюда ссылку на вашу страницу GitHub (как в адресной строке). Больше ничего вписывать не нужно:
// файл обновлений и страница скачивания берутся из неё автоматически.
const GITHUB_REPO = 'https://github.com/zemanoit026-png/vitreum-browser';
const REMOTE_CONFIG_URL = GITHUB_REPO.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/main/remote.json';
let remoteBusy = false;
const shownRemote = new Set();
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x > y) return true; if (x < y) return false; }
  return false;
}
async function checkRemote() {
  if (remoteBusy || REMOTE_CONFIG_URL.includes('ВАШ_НИК')) return;
  remoteBusy = true;
  try {
    const cfg = JSON.parse(await fetchUrl(REMOTE_CONFIG_URL, { timeout: 8000 }));
    const url = typeof cfg.downloadUrl === 'string' && cfg.downloadUrl.startsWith('https://') ? cfg.downloadUrl : GITHUB_REPO + '/releases/latest';
    if (cfg.disabled === true) {
      await dialog.showMessageBox({ type: 'warning', title: 'Vitreum', message: String(cfg.disabledMessage || 'Браузер отключён разработчиком.'), buttons: ['OK'] });
      app.quit(); return;
    }
    if (cfg.latestVersion && isNewer(cfg.latestVersion, app.getVersion())) {
      const key = 'u' + cfg.latestVersion;
      if (cfg.forceUpdate === true || !shownRemote.has(key)) {
        shownRemote.add(key);
        const r = await dialog.showMessageBox({ type: 'info', title: 'Обновление Vitreum', message: 'Вышло обновление: версия ' + cfg.latestVersion, detail: (cfg.message ? String(cfg.message) + '\n\n' : '') + 'У вас установлена версия ' + app.getVersion() + '.', buttons: cfg.forceUpdate ? ['Скачать'] : ['Скачать', 'Позже'] });
        if (r.response === 0 && url) shell.openExternal(url);
        if (cfg.forceUpdate === true) app.quit();
      }
    } else if (cfg.message && cfg.messageId && !shownRemote.has('m' + cfg.messageId)) {
      shownRemote.add('m' + cfg.messageId);
      dialog.showMessageBox({ type: 'info', title: 'Vitreum', message: String(cfg.message), buttons: ['OK'] });
    }
  } catch (err) { /* нет сети или файла: браузер работает как обычно */ }
  finally { remoteBusy = false; }
}
// Проверка один раз при запуске. Ничего не работает в фоне.
function startRemoteChecks() { setTimeout(checkRemote, 1200); }

app.on('will-quit', () => { vpnActive = false; stopXray(); });

ipcMain.handle('clear-cache', async () => {
  if (mainWindow) {
    try {
      await mainWindow.webContents.session.clearCache();
      await mainWindow.webContents.session.clearStorageData();
      return true;
    } catch (e) {}
  }
  return false;
});

ipcMain.handle('open-folder', async (e, filePath) => {
  if (filePath) { try { shell.showItemInFolder(filePath); } catch (err) {} }
});

ipcMain.on('window-action', (e, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); }
  if (action === 'close') mainWindow.close();
});

// ==========================================
// ИСПРАВЛЕНИЕ СКАЧИВАНИЯ: УБИРАЕМ ОКНО WINDOWS
// ==========================================
app.whenReady().then(() => {
  // Невидимое меню с ролями: именно оно включает Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z
  // во всём приложении, в том числе внутри сайтов (webview).
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Правка', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ] }
  ]));

  knownSessions.push(session.defaultSession);
  attachDownloadHandler(session.defaultSession);
  applyRegionToSessions();

  createWindow();
  startRemoteChecks();
  initAdBlocker();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });