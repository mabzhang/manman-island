import * as THREE from 'three';
import {rng} from './world.js';
// All patterns are periodic analytic fields; opposite edges are identical.
export function makeTextures(){
 const result={};for(const name of ['sand','seabed','grass','caustic','foam','glow']){
  const n=name==='glow'?128:256,c=document.createElement('canvas');c.width=c.height=n;const ctx=c.getContext('2d'),img=ctx.createImageData(n,n),r=rng(91),ph=Array.from({length:12},()=>r()*6.28);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const u=x/(n-1)*Math.PI*2,v=y/(n-1)*Math.PI*2;
   const noise=(Math.sin(u*17+v*11+ph[0])+Math.sin(u*31-v*23+ph[1])+Math.sin(u*7+v*5+ph[2]))/3;
   let rgb,a=255;
   if(name==='caustic'){const p=Math.sin(u*3+Math.sin(v*2)*1.2)*Math.cos(v*3+Math.sin(u*2)),q=Math.sin(v*4+Math.sin(u*3));const k=Math.pow(1-Math.min(1,Math.abs(p+q*.4)*4.3),2);rgb=[k*255,k*255,k*255]}
   else if(name==='foam'){const k=Math.pow(Math.max(0,(noise+.3)/1.3),2);rgb=[245,255,253];a=k*255}
   else if(name==='glow'){const d=Math.hypot(x/(n-1)*2-1,y/(n-1)*2-1);rgb=[255,232,162];a=Math.pow(Math.max(0,1-d),2.5)*255}
   else {const base=name==='grass'?[157,184,111]:name==='sand'?[233,217,171]:[152,180,148];const k=noise*14+Math.sin(v*25+Math.sin(u*4)*2)*3;rgb=base.map(b=>b+k)}
   const i=(y*n+x)*4;img.data.set([...rgb.map(v=>Math.max(0,Math.min(255,v))),a],i);
  }
  ctx.putImageData(img,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=['sand','seabed','grass'].includes(name)?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=4;result[name]=t;
 }return result;
}
