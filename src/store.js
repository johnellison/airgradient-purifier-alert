import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

const STATE_PATH = "airgradient/state.json";
const defaults = () => ({
  readings: [],
  settings: { alertThreshold:35, clearThreshold:25, durationMinutes:10, channel:"push", recipient:null, quietStart:null, quietEnd:null },
  alert: { status:"normal", pendingSince:null, changedAt:null, lastEventKey:null },
  subscriptions: []
});

export function createStore() {
  async function read() {
    const result = await get(STATE_PATH, { access:"private", useCache:false });
    if (!result) return { state:defaults(), etag:null };
    // Private Blob GET responses expose a weak ETag, while conditional PUT
    // requires the equivalent strong ETag.
    return { state:await new Response(result.stream).json(), etag:result.blob.etag.replace(/^W\//,"") };
  }
  async function mutate(change) {
    for (let attempt=0; attempt<6; attempt++) {
      const {state,etag}=await read();
      const next=await change(structuredClone(state));
      try {
        await put(STATE_PATH,JSON.stringify(next),{access:"private",contentType:"application/json",cacheControlMaxAge:60,...(etag?{allowOverwrite:true,ifMatch:etag}:{})});
        return next;
      } catch (error) {
        if (!(error instanceof BlobPreconditionFailedError) && etag) throw error;
        if (attempt===5) throw new Error("Persistent state was updated concurrently; retry ingestion");
        await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));
      }
    }
  }
  return {
    async initialize() { await mutate(state=>state); },
    async acquireIngestionLock() { return async()=>{}; },
    async saveReading(reading) { await mutate(state=>{ if(!state.readings.some(r=>r.timestamp===reading.timestamp)) state.readings.push(reading); const cutoff=Date.now()-48*60*60*1000; state.readings=state.readings.filter(r=>new Date(r.timestamp).getTime()>=cutoff).sort((a,b)=>a.timestamp.localeCompare(b.timestamp)); return state; }); },
    async latest() { const {state}=await read(); return state.readings.at(-1)??null; },
    async history(since) { const {state}=await read(); return state.readings.filter(r=>r.timestamp>=since).map(({timestamp,pm25})=>({timestamp,pm25})); },
    async settings() { return (await read()).state.settings; },
    async updateSettings(settings) { await mutate(state=>{state.settings={...state.settings,...settings};return state;}); },
    async alertState() { return (await read()).state.alert; },
    async updateAlertState(alert,eventKey=null) { await mutate(state=>{state.alert={...alert,lastEventKey:eventKey??state.alert.lastEventKey};return state;}); },
    async eventSeen(key) { return (await read()).state.alert.lastEventKey===key; },
    async saveSubscription(subscription) { await mutate(state=>{state.subscriptions=state.subscriptions.filter(s=>s.endpoint!==subscription.endpoint);state.subscriptions.push(subscription);return state;}); },
    async subscriptions() { return (await read()).state.subscriptions; },
    async removeSubscription(endpoint) { await mutate(state=>{state.subscriptions=state.subscriptions.filter(s=>s.endpoint!==endpoint);return state;}); },
    async close() {}
  };
}
