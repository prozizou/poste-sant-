'use strict';
// Optimistic compare-and-swap model: concurrent callbacks are retried, as in
// RTDB. Every successful proposal commits its entire subtree in one revision.
module.exports = function memoryDatabase(initial = {}) {
  let state=structuredClone(initial),revision=0;
  const stats={commits:0,retries:0,paths:[]};
  const parts=p=>p.split('/').filter(Boolean);
  function read(p){return parts(p).reduce((node,k)=>node?.[k],state) ?? null;}
  function write(p,value){
    const ss=parts(p);
    if(!ss.length){state=structuredClone(value);return;}
    let node=state;const key=ss.pop();
    for(const s of ss)node=node[s]??={};
    node[key]=structuredClone(value);
  }
  const db={ref(path){return {
    path,
    async once(){await Promise.resolve();return {val:()=>structuredClone(read(path))};},
    async transaction(callback){
      stats.paths.push(path);
      for(let i=0;i<100;i++){
        const rev=revision,proposal=callback(structuredClone(read(path)));
        if(proposal===undefined)return {committed:false,snapshot:{val:()=>structuredClone(read(path))}};
        // Let independent requests calculate from the same starting snapshot.
        await Promise.resolve();
        if(revision!==rev){stats.retries++;continue;}
        JSON.stringify(proposal,(_,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('Non-finite Firebase value');return v;});
        write(path,proposal);revision++;stats.commits++;
        return {committed:true,snapshot:{val:()=>structuredClone(read(path))}};
      }
      throw Error('Transaction retry limit');
    },
  };}};
  return {db,stats,state:()=>structuredClone(state)};
};
