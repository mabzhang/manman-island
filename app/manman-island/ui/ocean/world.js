// Deterministic shared terrain, safe navigation and persisted exploration state.
export const WORLD_SIZE = 320, HALF = 160, CELL = 2.5, GRID = 129;
export const HOME = { x: -62, z: -54, r: 21, name: '我的慢慢岛' };
export const ISLANDS = [HOME,{x:64,z:-65,r:22,name:'椰风湾'},{x:68,z:68,r:25,name:'灯塔岬'},{x:-70,z:75,r:18,name:'花眠屿'}];
export const REEFS = [{x:-3,z:-92,r:17},{x:28,z:-20,r:18},{x:112,z:13,r:16},{x:12,z:100,r:19},{x:-107,z:5,r:16},{x:-27,z:39,r:16}];
export const DOCK = {x:HOME.x+7,z:HOME.z+37};
export const FISH = [
 {name:'小丑鱼',color:'#f49b57',habitat:'珊瑚礁',weight:25}, {name:'蓝倒吊',color:'#699fdf',habitat:'珊瑚礁',weight:21},
 {name:'蝴蝶鱼',color:'#f2d477',habitat:'浅海',weight:18},{name:'沙丁鱼',color:'#b9d7dd',habitat:'开阔海面',weight:18},
 {name:'飞鱼',color:'#83c6d1',habitat:'远海',weight:12},{name:'红鲷',color:'#ef9295',habitat:'岛礁边缘',weight:10},
 {name:'石斑',color:'#aa9d77',habitat:'礁石附近 · 稀有',weight:3},{name:'金枪鱼',color:'#6787a6',habitat:'深海 · 稀有',weight:2}
];
export const LETTERS = ['慢一点，海也没有在赶路。','离开一小会儿，也是为了好好回来。','今天的风，刚好够鼓起一面帆。','小岛上的朋友，正在等你带回故事。','没有目的地的一段路，也算旅行。','不必每一竿，都有答案。','太阳落下以后，灯塔会接着亮。','把忙不完的事，先留在岸上。','你看，水下也有一座花园。','有些相遇，绕一点路才会碰到。','远方很大，家一直在那里。','谢谢你，认真收下这十二次海风。'];
export function rng(seed=9137){return()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const smooth=t=>t*t*(3-2*t);
const hash=(x,z)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n)};
export function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v}
export function heightAt(x,z){
 let h=-10+noise(x*.027,z*.027)*1.8+noise(x*.11,z*.11)*.45;
 for(const island of ISLANDS){const dx=x-island.x,dz=z-island.z,a=Math.atan2(dz,dx),rr=island.r*(1+.085*Math.sin(a*5)+.04*Math.cos(a*7));const d=Math.hypot(dx,dz)/rr;
 // Broad underwater terrace and dunes around each beach.
 const shelf=-3.7+Math.sin(d*12+a)*.35+(noise(x*.18,z*.18)-.5)*.6;
 const land=4.2-Math.pow(d,2.8)*5.1+(noise(x*.16,z*.16)-.5)*.85;
 if(d<1.95)h=Math.max(h,shelf-Math.max(0,d-1.38)*11,land);
 }
 for(const r of REEFS){const d=Math.hypot(x-r.x,z-r.z)/r.r;h=Math.max(h,-9+5.3*Math.exp(-d*d*2)+(noise(x*.16,z*.16)-.5)*.6)}
 return Math.max(-12,Math.min(5,h));
}
export const depthAt=(x,z)=>-heightAt(x,z);
export function makeNavigation(){
 const raw=new Uint8Array(GRID*GRID),safe=new Uint8Array(raw.length);
 const point=i=>({x:(i%GRID)*CELL-HALF,z:Math.floor(i/GRID)*CELL-HALF});
 for(let z=0;z<GRID;z++)for(let x=0;x<GRID;x++)raw[z*GRID+x]=depthAt(x*CELL-HALF,z*CELL-HALF)>.9?1:0;
 // One complete grid cell of clearance, including diagonal neighbors.
 for(let z=1;z<GRID-1;z++)for(let x=1;x<GRID-1;x++){let ok=1;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)ok&=raw[(z+dz)*GRID+x+dx];safe[z*GRID+x]=ok}
 const index=(x,z)=>Math.max(0,Math.min(GRID-1,Math.round((z+HALF)/CELL)))*GRID+Math.max(0,Math.min(GRID-1,Math.round((x+HALF)/CELL)));
 function nearest(x,z){let best=-1,d=Infinity;for(let i=0;i<safe.length;i++)if(safe[i]){const p=point(i),q=(p.x-x)**2+(p.z-z)**2;if(q<d){d=q;best=i}}return best}
 function line(a,b){const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/(CELL*.2));for(let j=0;j<=n;j++){const f=n?j/n:0;if(!safe[index(a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f)])return false}return true}
 function path(from,to){
  const start=nearest(from.x,from.z);if(start<0)return [];
  // Flood reachable water first: an on-land click resolves to the nearest REACHABLE cell.
  const reachable=new Uint8Array(safe.length),queue=[start];reachable[start]=1;
  const neighbors=i=>{const out=[];let x=i%GRID,z=Math.floor(i/GRID);for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dz)continue;const nx=x+dx,nz=z+dz,j=nz*GRID+nx;if(nx<0||nz<0||nx>=GRID||nz>=GRID||!safe[j])continue;if(dx&&dz&&(!safe[z*GRID+nx]||!safe[nz*GRID+x]))continue;out.push([j,dx&&dz?Math.SQRT2:1])}return out};
  for(let q=0;q<queue.length;q++)for(const[j]of neighbors(queue[q]))if(!reachable[j]){reachable[j]=1;queue.push(j)}
  let goal=start,dist=Infinity;for(const i of queue){const p=point(i),d=(p.x-to.x)**2+(p.z-to.z)**2;if(d<dist){dist=d;goal=i}}
  const g=new Float32Array(safe.length).fill(Infinity),parent=new Int32Array(safe.length).fill(-1),closed=new Uint8Array(safe.length);g[start]=0;
  // Binary min heap for A*; stale entries are skipped.
  const heap=[];const push=(i,f)=>{let n=heap.length;heap.push({i,f});while(n){let p=(n-1)>>1;if(heap[p].f<=f)break;heap[n]=heap[p];n=p}heap[n]={i,f}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let n=0;while(n*2+1<heap.length){let c=n*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[n]=heap[c];n=c}heap[n]=last}return top.i};
  const goalP=point(goal);push(start,0);
  while(heap.length){const i=pop();if(closed[i])continue;closed[i]=1;if(i===goal)break;for(const[j,cost]of neighbors(i)){const next=g[i]+cost;if(next<g[j]){g[j]=next;parent[j]=i;const p=point(j);push(j,next+Math.hypot(p.x-goalP.x,p.z-goalP.z)/CELL)}}}
  if(!closed[goal])return [];
  const list=[];for(let i=goal;i!==-1;i=parent[i]){list.push(point(i));if(i===start)break}list.reverse();
  const result=[{x:from.x,z:from.z}];let a=0;while(a<list.length-1){let b=list.length-1;while(b>a+1&&!line(list[a],list[b]))b--;result.push(list[b]);a=b}
  if(result.length===1)result.push(point(goal));return result;
 }
 return{safe,raw,point,index,nearest,line,path,isSafe:(x,z)=>Math.abs(x)<=HALF-CELL&&Math.abs(z)<=HALF-CELL&&!!safe[index(x,z)]};
}
export function freshVoyage(){return{version:1,x:DOCK.x,z:DOCK.z,heading:0,energy:1,clock:.3,bottles:[],fish:Array(8).fill(0),trips:0,distance:0,visited:[],sound:false}}
export function validateVoyage(v){
 if(!v||v.version!==1||!['x','z','heading','energy','clock','distance'].every(k=>Number.isFinite(v[k])))throw Error('航海存档数据无效');
 if(Math.abs(v.x)>HALF||Math.abs(v.z)>HALF||v.energy<0||v.energy>1||v.clock<0||v.clock>=1||v.distance<0||!Number.isSafeInteger(v.trips)||v.trips<0)throw Error('航海数值超出范围');
 if(!Array.isArray(v.bottles)||v.bottles.length>12||new Set(v.bottles).size!==v.bottles.length||!v.bottles.every(n=>Number.isInteger(n)&&n>=0&&n<12))throw Error('漂流瓶记录无效');
 if(!Array.isArray(v.fish)||v.fish.length!==8||!v.fish.every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('鱼图鉴记录无效');
 if(!Array.isArray(v.visited)||v.visited.length>10||new Set(v.visited).size!==v.visited.length||!v.visited.every(n=>Number.isInteger(n)&&n>=0&&n<10)||typeof v.sound!=='boolean')throw Error('航海设置无效');
 return JSON.parse(JSON.stringify(v));
}
