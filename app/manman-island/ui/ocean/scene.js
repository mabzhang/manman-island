import * as T from 'three';
import {WORLD_SIZE,HALF,ISLANDS,REEFS,HOME,DOCK,heightAt,rng} from './world.js';
import {makeTextures} from './textures.js';
const C=x=>new T.Color(x);
export function buildSea(canvas,homeCanvas,mobile=false){
 const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.35:1.65));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
 const scene=new T.Scene();scene.background=C('#b5e0df');scene.fog=new T.FogExp2('#b5e0df',.0048);
 const camera=new T.PerspectiveCamera(48,1,.3,1800),tex=makeTextures(),shared={uTime:{value:0},uDay:{value:1},uCaustic:{value:tex.caustic}};
 const ambient=new T.HemisphereLight('#e2ffef','#91a18d',2.1);scene.add(ambient);
 const sun=new T.DirectionalLight('#fff0cf',3.2);sun.position.set(-60,110,35);scene.add(sun);
 const wind=[];const lamps=[],windows=[],glows=[];
 function caustic(mat,windy=false){mat.onBeforeCompile=s=>{Object.assign(s.uniforms,shared);s.vertexShader='varying vec3 vSeaWorld; uniform float uTime;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\n${windy?'transformed.x += sin(uTime*1.4+position.y*1.8)*max(0.0,position.y)*.055;':''}`);s.vertexShader=s.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\nvec4 seaW=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nseaW=instanceMatrix*seaW;\n#endif\nvSeaWorld=(modelMatrix*seaW).xyz;`);s.fragmentShader='varying vec3 vSeaWorld; uniform float uTime; uniform float uDay; uniform sampler2D uCaustic;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>',`float ca=min(texture2D(uCaustic,vSeaWorld.xz*.038+vec2(uTime*.012,uTime*.008)).r,texture2D(uCaustic,vSeaWorld.xz*.052+vec2(-uTime*.009,uTime*.011)).r);float dep=max(0.0,-vSeaWorld.y); gl_FragColor.rgb+=vec3(.26,.48,.38)*ca*exp(-dep*.13)*step(vSeaWorld.y,-.08)*uDay;\n#include <dithering_fragment>`)};mat.customProgramCacheKey=()=>windy?'sea-wind-v1':'sea-caustic-v1';return mat}
 function material(color,extra={}){return caustic(new T.MeshStandardMaterial({color,roughness:.88,flatShading:true,...extra}))}
 const mat={wood:material('#b4916b'),dark:material('#806752'),sand:material('#ead8a8'),green:material('#7fa67f'),roof:material('#bf7c68'),rock:material('#8b9f9c'),white:material('#fff2d5'),red:material('#d76e64')};
 const dummy=new T.Object3D();
 function mesh(g,m,x=0,y=0,z=0,parent=scene){const o=new T.Mesh(g,m);o.position.set(x,y,z);parent.add(o);return o}
 function box(w,h,d,m,x,y,z,p=scene){return mesh(new T.BoxGeometry(w,h,d),m,x,y,z,p)}
 function cylinder(a,b,h,m,x,y,z,p=scene,n=7){return mesh(new T.CylinderGeometry(a,b,h,n),m,x,y,z,p)}
 // Low-poly seabed: vertex colors encode six elevation zones.
 const groundGeo=new T.PlaneGeometry(WORLD_SIZE,WORLD_SIZE,160,160);groundGeo.rotateX(-Math.PI/2);
 const pos=groundGeo.attributes.position,colors=[];const palette=['#8dafa5','#bfd3b0','#91b99f','#cfcb9d','#efdfb5','#a7c68c'].map(C);
 for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=heightAt(x,z);pos.setY(i,Math.hypot(x-HOME.x,z-HOME.z)<HOME.r*1.03?Math.min(h,-.18):h);let k=h<-6?0:h<-3?1:h<-.65?2:h<.1?3:h<1.05?4:5;const c=palette[k].clone().multiplyScalar(.92+.1*Math.sin(x*2+z*3));colors.push(c.r,c.g,c.b)}
 groundGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));groundGeo.computeVertexNormals();
 const ground=mesh(groundGeo,material('#ffffff',{vertexColors:true}));
 // Periodic fine sand detail without fetching any bitmap.
 ground.material.onBeforeCompile=((base)=>s=>{base(s);s.uniforms.uSand={value:tex.sand};s.uniforms.uGrass={value:tex.grass};s.uniforms.uBed={value:tex.seabed};s.fragmentShader='uniform sampler2D uSand; uniform sampler2D uGrass; uniform sampler2D uBed;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\nvec3 detail=texture2D(uSand,vSeaWorld.xz*.11).rgb;if(vSeaWorld.y>1.05)detail=texture2D(uGrass,vSeaWorld.xz*.16).rgb;if(vSeaWorld.y<-.8)detail=texture2D(uBed,vSeaWorld.xz*.08).rgb;diffuseColor.rgb*=mix(vec3(1.0),detail,0.22);`) })(ground.material.onBeforeCompile);
 // Height texture coordinates exactly match world x/z, independent of mesh winding.
 const n=256,depthData=new Uint8Array(n*n*4);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const h=heightAt(x/(n-1)*WORLD_SIZE-HALF,y/(n-1)*WORLD_SIZE-HALF),i=(y*n+x)*4;depthData[i]=Math.round((h+12)/18*255);depthData[i+1]=depthData[i+2]=depthData[i];depthData[i+3]=255}
 const heightTex=new T.DataTexture(depthData,n,n,T.RGBAFormat);heightTex.needsUpdate=true;heightTex.magFilter=T.LinearFilter;heightTex.minFilter=T.LinearFilter;
 const waterUniforms={uTime:shared.uTime,uHeight:{value:heightTex},uFoam:{value:tex.foam},uShallow:{value:C('#8ce5cd')},uMid:{value:C('#43bcbf')},uDeep:{value:C('#267da3')},uFog:{value:C('#b5e0df')},uSun:{value:new T.Vector3(-.4,.8,.3)},uLight:{value:1},uEye:{value:new T.Vector3()}};
 const waterMat=new T.ShaderMaterial({uniforms:waterUniforms,transparent:true,depthWrite:false,side:T.DoubleSide,
 vertexShader:`varying vec3 vW;uniform float uTime;void main(){vec3 p=position;p.y+=sin(p.x*.19+uTime*.8)*.065+cos(p.z*.23-uTime*.7)*.045;vW=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);}`,
 fragmentShader:`precision highp float;varying vec3 vW;uniform sampler2D uHeight,uFoam;uniform float uTime,uLight;uniform vec3 uShallow,uMid,uDeep,uFog,uSun,uEye;
 void main(){vec2 uv=(vW.xz+160.)/320.;float h=texture2D(uHeight,uv).r*18.-12.;if(abs(vW.x)>159.||abs(vW.z)>159.)h=-11.;float d=max(0.,-h);if(h>.14)discard;
 vec3 col=mix(uShallow,uMid,smoothstep(.35,4.5,d));col=mix(col,uDeep,smoothstep(4.5,11.,d));
 vec3 n=normalize(vec3(cos(vW.x*.51+vW.z*.32+uTime)*.055,1.,sin(vW.z*.39-uTime*.85)*.07));vec3 view=normalize(uEye-vW);float f=pow(1.-max(0.,dot(view,n)),3.);col=mix(col,uFog,.10+f*.22);
 float spec=pow(max(0.,dot(reflect(-uSun,n),view)),150.);col+=vec3(1.,.93,.72)*spec*.52*uLight;
 float shore=1.-smoothstep(.05,1.0,d);float wave=pow(max(0.,sin(d*6.8+uTime*1.9)),12.)*(1.-smoothstep(0.,2.8,d));float foam=texture2D(uFoam,vW.xz*.2+uTime*.011).a;col=mix(col,vec3(.92,.99,.95),clamp(shore*.6+wave*(.45+foam*.6),0.,.8));
 float fog=1.-exp(-length(uEye-vW)*.0048);col=mix(col,uFog,smoothstep(.45,1.,fog));float alpha=mix(.24,.94,smoothstep(0.,7.,d));alpha=max(alpha,shore*.65+wave*.4);gl_FragColor=vec4(col,alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const waterGeo=new T.PlaneGeometry(1800,1800,100,100);waterGeo.rotateX(-Math.PI/2);const water=mesh(waterGeo,waterMat);water.renderOrder=2;
 // Dome shares its horizon color with distance fog.
 const skyU={top:{value:C('#79becf')},horizon:waterUniforms.uFog};
 const sky=mesh(new T.SphereGeometry(950,24,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:skyU,vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 vP;uniform vec3 top,horizon;void main(){gl_FragColor=vec4(mix(horizon,top,pow(max(0.,normalize(vP).y),.6)),1.); #include <tonemapping_fragment>\n #include <colorspace_fragment>\n}'}));sky.material.fragmentShader=sky.material.fragmentShader.replace('; #include',';\n#include');
 const random=rng(441),starPos=[];for(let i=0;i<650;i++){const a=random()*Math.PI*2,y=random()*.86+.1,r=700*Math.sqrt(1-y*y);starPos.push(Math.cos(a)*r,y*700,Math.sin(a)*r)}
 const stars=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(starPos,3)),new T.PointsMaterial({color:'#e6f3ff',size:1.5,transparent:true,opacity:0,depthWrite:false,fog:false}));scene.add(stars);
 const sunDisc=mesh(new T.SphereGeometry(10,16,12),new T.MeshBasicMaterial({color:'#fff3c4',fog:false}));
 const moon=mesh(new T.SphereGeometry(6,12,8),new T.MeshBasicMaterial({color:'#dcecf1',fog:false}));
 function glow(x,y,z,size=3){const s=new T.Sprite(new T.SpriteMaterial({map:tex.glow,color:'#ffe3a3',transparent:true,depthWrite:false,blending:T.AdditiveBlending}));s.position.set(x,y,z);s.scale.setScalar(size);scene.add(s);glows.push(s);return s}
 // Docks, houses, lighthouse and scattered vegetation.
 function dock(x,z){box(3,.45,13,mat.wood,x,.75,z);for(let i=-5;i<=5;i++)box(3.1,.09,.12,mat.dark,x,1.02,z+i);for(const dz of[-5,4])for(const dx of[-1.1,1.1]){cylinder(.16,.2,3,mat.dark,x+dx,-.35,z+dz);if(dx>0){cylinder(.09,.1,3.3,mat.dark,x+dx,2.3,z+dz);const lm=new T.MeshStandardMaterial({color:'#fff5ca',emissive:'#ffc76b',emissiveIntensity:0});box(.45,.6,.45,lm,x+dx,3.9,z+dz);lamps.push(lm);glow(x+dx,3.9,z+dz,3)}}}
 dock(HOME.x+7,HOME.z+26);
 function house(x,z){const y=heightAt(x,z);box(5,3.5,4,mat.wood,x,y+1.75,z);const roof=mesh(new T.ConeGeometry(4.3,2.4,4),mat.roof,x,y+4.6,z);roof.rotation.y=Math.PI/4;const winM=new T.MeshStandardMaterial({color:'#d9e8cc',emissive:'#ffd587',emissiveIntensity:0});box(1.15,1.3,.08,winM,x+1.1,y+2,z+2.03);box(1.1,2.3,.09,mat.dark,x-1.2,y+1.2,z+2.04);windows.push(winM);glow(x+1.1,y+2,z+2.2,4)}
 house(61,-67);house(-73,75);
 const lh={x:67,z:68},ly=heightAt(lh.x,lh.z);for(let i=0;i<6;i++)cylinder(1.65-i*.09,1.75-i*.09,1.9,i%2?mat.white:mat.red,lh.x,ly+i*1.9+.95,lh.z);
 cylinder(2,2,.35,mat.dark,lh.x,ly+11.6,lh.z);cylinder(.95,1.2,1.7,mat.white,lh.x,ly+12.5,lh.z);cylinder(0,1.65,1.5,mat.red,lh.x,ly+14,lh.z);
 const beamGroup=new T.Group();beamGroup.position.set(lh.x,ly+12.5,lh.z);scene.add(beamGroup);
 const beamMat=new T.MeshBasicMaterial({color:'#fff1b3',transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending});
 const beam=mesh(new T.ConeGeometry(9,85,24,1,true),beamMat,42,0,0,beamGroup);beam.rotation.z=-Math.PI/2;glow(lh.x,ly+12.5,lh.z,6);
 for(const [idx,island]of ISLANDS.entries()){
  if(idx===0)continue;
  for(let j=0;j<10;j++){const a=random()*6.28,r=island.r*(.2+random()*.46),x=island.x+Math.cos(a)*r,z=island.z+Math.sin(a)*r,y=heightAt(x,z);if(y<1.1||Math.hypot(x-lh.x,z-lh.z)<4)continue;
   const palm=new T.Group();palm.position.set(x,y,z);palm.rotation.y=random()*6.28;scene.add(palm);for(let k=0;k<5;k++)cylinder(.18,.24,.95,mat.wood,k*.15,k*.88+.4,0,palm,6);
   const crown=new T.Group();crown.position.set(.7,4.7,0);palm.add(crown);for(let k=0;k<7;k++){const leafGeo=new T.BufferGeometry(),p=[];const a=k*6.28/7;for(let s=0;s<5;s++){const d=s/4*3.8,dd=(s+1)/4*3.8;const w=Math.sin((s+.4)/5*Math.PI)*.54,ww=Math.sin((s+1.4)/5*Math.PI)*.54;const at=(t,b)=>[Math.cos(a)*t+Math.sin(a)*b,Math.sin(t*.75)*.6-t*.27,Math.sin(a)*t-Math.cos(a)*b];p.push(...at(d,-w),...at(dd,-ww),...at(dd,ww),...at(d,-w),...at(dd,ww),...at(d,w))}leafGeo.setAttribute('position',new T.Float32BufferAttribute(p,3));leafGeo.computeVertexNormals();mesh(leafGeo,material(j%2?'#70ad91':'#8cc4a0',{side:T.DoubleSide}),0,0,0,crown)}wind.push(crown)
  }
  for(let k=0;k<25;k++){const a=random()*6.28,d=random()*island.r*.8,x=island.x+Math.cos(a)*d,z=island.z+Math.sin(a)*d,y=heightAt(x,z);if(y<.6)continue;mesh(new T.IcosahedronGeometry(.5+random()*.8,0),k%3?mat.green:mat.rock,x,y+.45,z);if(k%3===0)for(let j=0;j<4;j++)mesh(new T.IcosahedronGeometry(.19,0),material(['#fff2bf','#e6a8ba','#b3cbee'][k%3]),x+(random()-.5)*1.8,y+.9,z+(random()-.5)*1.8)}
 }
 // Keep the exact original island and residents visible in the same 3D world.
 const homeTexture=new T.CanvasTexture(homeCanvas);homeTexture.colorSpace=T.SRGBColorSpace;
 const homeSprite=new T.Sprite(new T.SpriteMaterial({map:homeTexture,transparent:true,depthWrite:false,fog:true}));homeSprite.position.set(HOME.x,8,HOME.z);homeSprite.scale.set(43,29,1);homeSprite.renderOrder=3;scene.add(homeSprite);
 // Thousands of instanced reef plants, a handful of materials and draw calls.
 const count=mobile?2400:4200,plantGeo=new T.ConeGeometry(.45,1.8,5,2),plantMat=caustic(new T.MeshStandardMaterial({color:'#ffffff',roughness:.85,flatShading:true}),true),plants=new T.InstancedMesh(plantGeo,plantMat,count);scene.add(plants);
 for(let i=0;i<count;i++){const reef=REEFS[i%6],a=random()*6.28,d=Math.sqrt(random())*reef.r*1.15,x=reef.x+Math.cos(a)*d,z=reef.z+Math.sin(a)*d,y=heightAt(x,z),s=.45+random()*1.15;dummy.position.set(x,y+s*.5,z);dummy.rotation.set((random()-.5)*.5,a,(random()-.5)*.4);dummy.scale.set(.4+random()*.9,s,.4+random()*.8);dummy.updateMatrix();plants.setMatrixAt(i,dummy.matrix);plants.setColorAt(i,C(['#df9eaa','#aeaecf','#e7be91','#6cba9b','#78b3a8','#9fc395'][i%6]))}plants.instanceMatrix.needsUpdate=true;
 const coralCount=mobile?300:600,corals=new T.InstancedMesh(new T.IcosahedronGeometry(.7,0),plantMat,coralCount);scene.add(corals);for(let i=0;i<coralCount;i++){const r=REEFS[i%6],a=random()*6.28,d=random()*r.r,x=r.x+Math.cos(a)*d,z=r.z+Math.sin(a)*d;dummy.position.set(x,heightAt(x,z)+.35,z);dummy.rotation.set(0,a,0);dummy.scale.set(1,.55+random(),1);dummy.updateMatrix();corals.setMatrixAt(i,dummy.matrix);corals.setColorAt(i,C(['#e9acb4','#a2c8bd','#d0b3d9'][i%3]))}
 const schoolGeo=new T.SphereGeometry(.35,6,4);schoolGeo.scale(.52,.62,1.5);const fishCount=20*(mobile?12:20),fishMesh=new T.InstancedMesh(schoolGeo,material('#ffffff',{roughness:.5}),fishCount);scene.add(fishMesh);
 const schools=[];for(let i=0;i<20;i++){const r=REEFS[i%6],a=i*2.4,x=r.x+Math.sin(a)*21,z=r.z+Math.cos(a)*21;schools.push({x,z,baseX:x,baseZ:z,phase:random()*6.28,y:-1.5-random()*1.2});for(let k=0;k<fishCount/20;k++)fishMesh.setColorAt(i*(fishCount/20)+k,C(['#f6ca87','#a9d9dd','#e6b2a7','#8b9fc7'][i%4]))}
 const turtles=[];for(let i=0;i<4;i++){const g=new T.Group();scene.add(g);const shell=mesh(new T.SphereGeometry(.9,8,5),mat.green,0,0,0,g);shell.scale.set(.9,.43,1.2);mesh(new T.SphereGeometry(.28,6,4),mat.sand,0,0,1.1,g);const fins=[];for(const side of[-1,1])for(const z of[-.6,.55]){const f=mesh(new T.SphereGeometry(.45,5,3),mat.green,side*.8,-.12,z,g);f.scale.set(1.6,.12,.5);fins.push(f)}turtles.push({g,fins})}
 const gulls=[];for(let i=0;i<9;i++){const g=new T.Group();scene.add(g);const wings=[];for(const side of[-1,1]){const geo=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([0,0,0,side*1.5,.1,.2,side*.5,0,-.35],3));geo.computeVertexNormals();wings.push(mesh(geo,new T.MeshBasicMaterial({color:'#fff8e6',side:T.DoubleSide}),0,0,0,g))}gulls.push({g,wings})}
 // Boat made entirely from geometry.
 const boat=new T.Group();scene.add(boat);const shape=new T.Shape();shape.moveTo(-.85,-1.6);shape.lineTo(.85,-1.6);shape.lineTo(1.0,.6);shape.quadraticCurveTo(.8,1.45,0,2.0);shape.quadraticCurveTo(-.8,1.45,-1,.6);shape.closePath();
 const hullGeo=new T.ExtrudeGeometry(shape,{depth:.6,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.12,bevelThickness:.1});hullGeo.rotateX(Math.PI/2);mesh(hullGeo,mat.white,0,.55,0,boat);box(1.55,.15,2.5,mat.wood,0,.65,-.1,boat);cylinder(.055,.075,3.9,mat.dark,0,2.55,.15,boat,6);
 const sailGeo=new T.PlaneGeometry(2.1,3.1,10,10);sailGeo.translate(1.05,2.9,.15);const sail=mesh(sailGeo,new T.MeshStandardMaterial({color:'#fff1d8',side:T.DoubleSide,roughness:1}),0,0,0,boat);const sailBase=sailGeo.attributes.position.array.slice();box(.8,.12,.4,mat.dark,0,.9,-.9,boat);
 const flag=mesh(new T.PlaneGeometry(.55,.28),mat.red,.25,4.6,.15,boat);
 // Fishing rod, line, and float become visible only during a cast.
 const rig=new T.Group();rig.visible=false;boat.add(rig);const rod=cylinder(.018,.034,3,mat.dark,.7,1.7,0,rig,5);rod.rotation.z=-.7;
 const fishingLine=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(1.7,2.8,0),new T.Vector3(3.5,.04,1)]),new T.LineBasicMaterial({color:'#f8f0d0',transparent:true,opacity:.75}));rig.add(fishingLine);const bobber=mesh(new T.SphereGeometry(.16,8,6),mat.red,3.5,.1,1,rig);
 // Bottle meshes, gentle additive pillars.
 const bottlePositions=[];for(let i=0;i<12;i++){const reef=REEFS[i%6],a=(i*.87+.4);bottlePositions.push({x:reef.x+Math.cos(a)*22,z:reef.z+Math.sin(a)*22})}bottlePositions[0]={x:DOCK.x+6,z:DOCK.z+10};
 const bottles=bottlePositions.map((p,i)=>{const g=new T.Group();g.position.set(p.x,.2,p.z);scene.add(g);const glass=material('#a9e9cb',{transparent:true,opacity:.72});cylinder(.17,.26,.7,glass,0,0,0,g);cylinder(.09,.12,.27,mat.wood,0,.47,0,g);box(.15,.32,.13,mat.white,0,0,.16,g);const beam=mesh(new T.CylinderGeometry(.3,.8,9,12,1,true),new T.MeshBasicMaterial({color:'#fff5cd',transparent:true,opacity:.12,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending}),0,4.6,0,g);glow(p.x,.6,p.z,2.5).userData.bottle=i;return{g,p,beam}});
 // Route, destination ripple and segmented foam ribbon.
 let routeLine=null;const ringMat=new T.MeshBasicMaterial({color:'#faffed',transparent:true,opacity:.6,side:T.DoubleSide,depthWrite:false});const rings=Array.from({length:3},()=>{const o=mesh(new T.RingGeometry(.9,1.03,48),ringMat.clone());o.rotation.x=-Math.PI/2;o.visible=false;o.renderOrder=4;return o});
 const trailGeo=new T.BufferGeometry();const trailMat=new T.MeshBasicMaterial({color:'#effff7',transparent:true,opacity:.55,map:tex.foam,vertexColors:true,side:T.DoubleSide,depthWrite:false});const trail=mesh(trailGeo,trailMat);trail.renderOrder=4;
 const wakeLines=[0,1].map(()=>{const l=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#effff7',transparent:true,opacity:.55,vertexColors:true}));l.renderOrder=4;scene.add(l);return l});
 function route(points){if(routeLine){scene.remove(routeLine);routeLine.geometry.dispose();routeLine.material.dispose();routeLine=null}if(points.length>1){const geo=new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(p.x,.21,p.z)));routeLine=new T.Line(geo,new T.LineDashedMaterial({color:'#f5ffed',dashSize:1.05,gapSize:.8,transparent:true,opacity:.7,depthTest:false}));routeLine.computeLineDistances();routeLine.renderOrder=5;scene.add(routeLine)}rings.forEach(o=>o.visible=points.length>1);}
 function wake(history,t){const positions=[],cs=[],uvs=[],ls=[[],[]],lc=[];for(let i=0;i<history.length;i++){const h=history[i],alpha=Math.max(0,1-(t-h.t)/7),width=.65+(1-alpha)*1.5,dx=Math.cos(h.heading)*width,dz=-Math.sin(h.heading)*width;
 for(const side of[0,1])ls[side].push(h.x+dx*(side?1:-1),.14,h.z+dz*(side?1:-1));lc.push(1,1,1,alpha);
 if(i<history.length-1){const b=history[i+1],a1=[h.x-dx,.13,h.z-dz],a2=[h.x+dx,.13,h.z+dz],b1=[b.x-dx,.13,b.z-dz],b2=[b.x+dx,.13,b.z+dz];if(i%3!==0){positions.push(...a1,...b1,...b2,...a1,...b2,...a2);for(const p of[a1,b1,b2,a1,b2,a2]){cs.push(1,1,1,alpha);uvs.push(p[0]*.5,p[2]*.5)}}}}
 trailGeo.setAttribute('position',new T.Float32BufferAttribute(positions,3));trailGeo.setAttribute('color',new T.Float32BufferAttribute(cs,4));trailGeo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));trailGeo.computeBoundingSphere();trail.visible=positions.length>0;wakeLines.forEach((l,i)=>{l.visible=history.length>1;l.geometry.dispose();l.geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(ls[i],3)).setAttribute('color',new T.Float32BufferAttribute(lc,4))})}
 const frames=[
  {t:0,top:'#26395f',fog:'#6e859a',shallow:'#538b92',mid:'#285f7d',deep:'#193d64',light:.15,sun:'#a8c3e7',label:'月夜'},
  {t:.13,top:'#e6bcae',fog:'#e3d8bf',shallow:'#b4dac6',mid:'#6aadaf',deep:'#467990',light:.6,sun:'#ffdba7',label:'黎明'},
  {t:.25,top:'#7fcbd9',fog:'#bce4df',shallow:'#a0ecd4',mid:'#31b6b6',deep:'#176a95',light:1,sun:'#fff2d2',label:'白天'},
  {t:.53,top:'#84cbd5',fog:'#b9dfd5',shallow:'#a1e7ca',mid:'#4fb9b6',deep:'#1c7198',light:1,sun:'#fff0d4',label:'白天'},
  {t:.65,top:'#cba8a3',fog:'#f1cfb1',shallow:'#c6d8ba',mid:'#84b6ad',deep:'#637b95',light:.7,sun:'#ffd294',label:'黄昏'},
  {t:.74,top:'#a28ca7',fog:'#dfb0ab',shallow:'#a9bdb6',mid:'#668e9d',deep:'#4b658b',light:.35,sun:'#ffb77f',label:'日落'},
  {t:.86,top:'#172a4b',fog:'#526e88',shallow:'#528d90',mid:'#2d627e',deep:'#203e62',light:.1,sun:'#a0b7e8',label:'月夜'},
  {t:1,top:'#26395f',fog:'#6e859a',shallow:'#538b92',mid:'#285f7d',deep:'#193d64',light:.15,sun:'#a8c3e7',label:'月夜'}
 ];
 let phase='白天',night=0;
 function daylight(clock){let a=frames[0],b=frames[1];for(let i=0;i<frames.length-1;i++)if(clock>=frames[i].t&&clock<frames[i+1].t){a=frames[i];b=frames[i+1];break}const f=(clock-a.t)/(b.t-a.t),mix=k=>C(a[k]).lerp(C(b[k]),f);const light=T.MathUtils.lerp(a.light,b.light,f);phase=a.label;night=1-T.MathUtils.smoothstep(light,.25,.75);
 shared.uDay.value=light;ambient.intensity=.35+light*1.8;sun.intensity=.2+light*3;sun.color.copy(mix('sun'));const angle=(clock-.25)*Math.PI*2;sun.position.set(Math.cos(angle)*100,Math.sin((clock-.12)*Math.PI*2)*100,40);waterUniforms.uSun.value.copy(sun.position).normalize();waterUniforms.uLight.value=light;waterUniforms.uShallow.value.copy(mix('shallow'));waterUniforms.uMid.value.copy(mix('mid'));waterUniforms.uDeep.value.copy(mix('deep'));waterUniforms.uFog.value.copy(mix('fog'));scene.fog.color.copy(mix('fog'));scene.background.copy(mix('fog'));skyU.top.value.copy(mix('top'));stars.material.opacity=night*.8;
 sunDisc.position.copy(sun.position).normalize().multiplyScalar(650);sunDisc.visible=light>.2;moon.position.copy(sunDisc.position).multiplyScalar(-1);moon.position.y=Math.max(80,moon.position.y);moon.visible=night>.2;
 for(const m of[...lamps,...windows])m.emissiveIntensity=night*2.5;for(const g of glows)g.material.opacity=g.userData.bottle!==undefined?.6:night*.8;beamMat.opacity=night*.055;renderer.toneMappingExposure=1.03+light*.12;
 }
 function animate(t,dt,state){shared.uTime.value=t;daylight(state.clock);beamGroup.rotation.y=t*.2;wind.forEach((p,i)=>{p.rotation.x=Math.sin(t*1.2+i)*.06;p.rotation.z=Math.cos(t*.9+i)*.07});
 boat.position.set(state.x,.3+Math.sin(t*2)*.065,state.z);boat.rotation.set(Math.sin(t*1.4)*.025,state.heading,state.lean||0);const sp=sailGeo.attributes.position;for(let i=0;i<sp.count;i++){const x=sailBase[i*3],y=sailBase[i*3+1];sp.setZ(i,sailBase[i*3+2]+Math.sin(x/2.1*Math.PI)*Math.sin((y-1.35)/3.1*Math.PI)*(.18+(state.speed||0)*.045)+Math.sin(t*4+y)*.035)}sp.needsUpdate=true;sailGeo.computeVertexNormals();flag.rotation.y=Math.sin(t*4)*.2;rig.visible=!!state.fishing;bobber.position.y=.12+Math.sin(t*5)*.07;
 schools.forEach((s,i)=>{const dx=s.x-state.x,dz=s.z-state.z,d=Math.hypot(dx,dz);if(d<10&&state.speed>.1){s.x+=dx/Math.max(d,.1)*dt*5;s.z+=dz/Math.max(d,.1)*dt*5}else{s.x+=(s.baseX+Math.sin(t*.12+s.phase)*7-s.x)*dt*.12;s.z+=(s.baseZ+Math.cos(t*.12+s.phase)*7-s.z)*dt*.12}const angle=t*.28+s.phase;for(let j=0;j<fishCount/20;j++){const a=j*2.4,spread=Math.sqrt(j)*.48,x=s.x+Math.sin(a+angle)*spread,z=s.z+Math.cos(a+angle)*spread;dummy.position.set(x,Math.max(heightAt(x,z)+.6,s.y+Math.sin(t*1.6+j)*.12),z);dummy.rotation.set(0,angle+Math.sin(t*8+j)*.12,0);dummy.scale.setScalar(.8+(j%4)*.12);dummy.updateMatrix();fishMesh.setMatrixAt(i*(fishCount/20)+j,dummy.matrix)}});fishMesh.instanceMatrix.needsUpdate=true;
 turtles.forEach(({g,fins},i)=>{const a=t*.035+i*1.6;g.position.set(Math.sin(a)*103,-1.25,Math.cos(a)*100);if(heightAt(g.position.x,g.position.z)>-1.8)g.position.y=-.1;g.rotation.y=a+Math.PI/2;fins.forEach((f,j)=>f.rotation.z=Math.sin(t*2+j)*.3)});
 gulls.forEach(({g,wings},i)=>{const a=t*.1+i*.8;g.position.set(HOME.x+Math.cos(a)*(24+i*3),23+i*1.5,HOME.z+Math.sin(a)*(24+i*3));g.rotation.y=-a;wings.forEach((w,j)=>w.rotation.z=Math.sin(t*3+i)*.14*(j?1:-1))});
 bottles.forEach(({g},i)=>{g.visible=!state.bottles.includes(i);g.position.y=.35+Math.sin(t*1.8+i)*.14;g.rotation.z=.15+Math.sin(t+i)*.12});for(const g of glows)if(g.userData.bottle!==undefined)g.visible=!state.bottles.includes(g.userData.bottle);
 rings.forEach((r,i)=>{if(!state.target){r.visible=false;return}const q=(t*.65+i/3)%1;r.position.set(state.target.x,.2,state.target.z);r.scale.setScalar(.7+q*3);r.material.opacity=(1-q)*.65;r.visible=true});waterUniforms.uEye.value.copy(camera.position);
 }
 function resize(w,h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
 return{renderer,scene,camera,boat,homeSprite,homeTexture,schools,bottles,route,wake,animate,resize,get phase(){return phase},get night(){return night},get stats(){return{plants:count+coralCount,schools:20,fish:fishCount,islands:4,reefs:6}},dispose(){scene.traverse(o=>{o.geometry?.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose())}});Object.values(tex).forEach(t=>t.dispose());heightTex.dispose();homeTexture.dispose();renderer.dispose()}};
}
