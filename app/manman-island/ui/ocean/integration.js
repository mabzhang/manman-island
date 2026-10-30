import {freshVoyage} from './world.js';
export function mountOcean({host,game,snapshot,themeId,themeName,onReturn}){
 const dock=document.createElement('button');dock.id='seaDock';dock.type='button';dock.setAttribute('aria-label','点击岸边的小船，出海航行');dock.innerHTML=`<svg viewBox="0 0 130 100" aria-hidden="true"><ellipse cx="65" cy="85" rx="58" ry="12" fill="#bdddd0" opacity=".6"/><g stroke="#e5d5b1" stroke-width="3"><path d="M7 32 35 42M13 29l-5 13M21 33l-5 13M29 37l-5 13"/></g><path d="M28 69q20 26 59 6l22-17-39 7z" fill="#f4edda" stroke="#a58d70" stroke-width="1.4"/><path d="m30 68 39-13 37 5-37 13z" fill="#c8aa7b"/><path d="M66 60V9" stroke="#8e8268" stroke-width="3"/><path d="M70 13q30 18 27 37L70 55z" fill="#fffae5" stroke="#e9d7b4"/><path d="m62 23-21 30 22 2z" fill="#e3c6a6"/><path d="m67 7 17 4-16 6z" fill="#d98777"/></svg><span>乘船出海 ↗</span>`;
 document.querySelector('.scene-wrap').append(dock);const summary=document.createElement('div');summary.id='seaHomeSummary';document.querySelector('.scene-wrap').after(summary);
 let voyage=null,loading=false;const key=()=>`slow-island.voyage.v1.${themeId()}`;
 function refresh(){const info=game.inspect(),visible=info.running&&!info.readOnly&&document.getElementById('studio').style.display!=='none';dock.hidden=!visible;summary.hidden=!visible;if(!visible)return;const c=document.getElementById('scene'),r=c.getBoundingClientRect(),p=game.project(.94,.92),wrap=document.querySelector('.scene-wrap').getBoundingClientRect();dock.style.left=Math.max(58,Math.min(wrap.width-58,(r.left-wrap.left)+p.x*r.width/c.width+22))+'px';dock.style.top=((r.top-wrap.top)+p.y*r.height/c.height+4)+'px';try{const state=JSON.parse(host.storage.getItem(key())||'null')||freshVoyage();summary.textContent=`海屿航海记 · 漂流来信 ${state.bottles.length}/12 · 鱼图鉴 ${state.fish.filter(n=>n>0).length}/8 · 点击岸边的小船出海`}catch{summary.textContent='航海收藏暂时无法读取，请检查存档'}}
 dock.onclick=async()=>{if(loading||!host.canRun()||game.inspect().readOnly)return;loading=true;dock.disabled=true;const wait=document.createElement('div');wait.className='sea-loading';wait.textContent='把帆升起来，海就在小岛外面……';document.body.append(wait);try{
  if(!voyage){const {createVoyage}=await import('./main.js');voyage=createVoyage({host,game,snapshot,key:key(),onReturn:info=>{if(info.fish||info.bottles||info.distance>20)onReturn(`从海屿返航，航行了 ${info.distance} 米，带回 ${info.bottles} 封漂流来信和 ${info.fish} 条鱼。`);refresh()}})}
  await voyage.open();
 }catch(error){const toast=document.getElementById('toast');toast.textContent='出海未能启动：'+error.message+'。小岛仍可继续使用。';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),8000);console.error('Ocean startup failed',error);if(voyage?.active){voyage.dispose();voyage=null}document.body.classList.remove('sea-active');game.resume()}
 finally{loading=false;dock.disabled=false;wait.remove()}};
 const originalResume=game.resume,originalSuspend=game.suspend,originalSave=game.save,originalStop=game.stop;
 game.resume=()=>voyage?.active?voyage.resume():originalResume();game.suspend=(save=true)=>{voyage?.pause(save);originalSuspend(save)};game.save=()=>{voyage?.save();originalSave()};game.stop=()=>{if(voyage){voyage.dispose();voyage=null}originalStop();refresh()};
 const c=document.getElementById('scene');const observer=new MutationObserver(refresh);observer.observe(document.getElementById('studio'),{attributes:true,attributeFilter:['style']});observer.observe(c,{attributes:true,attributeFilter:['width','height']});
 // Low-frequency positioning follows original 45-degree camera controls.
 const timer=setInterval(()=>{if(!voyage?.active&&!document.hidden)refresh()},500);
 refresh();window.addEventListener('pagehide',()=>{clearInterval(timer);observer.disconnect()});
 window.haiyu=Object.freeze({inspect:()=>voyage?.inspect()??{active:false},navigate:(x,z)=>voyage?.navigate(x,z),fish:()=>voyage?.fish()});
 return{refresh};
}
