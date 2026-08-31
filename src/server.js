import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { fetchCurrent } from "./airgradient.js";
import { createStore } from "./store.js";
import { configurePush, notify, sendPush } from "./notifications.js";
import { dataFreshness, evaluateAlert } from "./alert-engine.js";

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
const store = createStore();
configurePush(env);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit:"20kb" }));

function safeEqual(a, b) { const x=Buffer.from(a||""); const y=Buffer.from(b||""); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function auth(req,res,next) {
  const username=env.APP_USERNAME||"air";
  const password=env.APP_PASSWORD;
  if (!password) return res.status(503).send("APP_PASSWORD is not configured");
  const [scheme,encoded] = (req.headers.authorization||"").split(" ");
  const credentials = scheme === "Basic" && encoded ? Buffer.from(encoded,"base64").toString() : ":";
  const separator=credentials.indexOf(":");
  const suppliedUsername=credentials.slice(0,separator), suppliedPassword=credentials.slice(separator+1);
  if (!safeEqual(suppliedUsername,username)||!safeEqual(suppliedPassword,password)) { res.set("WWW-Authenticate",`Basic realm="${env.APP_NAME||"Air monitor"}", charset="UTF-8"`); return res.status(401).send("Authentication required"); }
  next();
}

const runtimeSettings = async () => ({ ...await store.settings(), staleMinutes:Number(env.STALE_AFTER_MINUTES||10), offlineMinutes:Number(env.OFFLINE_AFTER_MINUTES||30) });
function isQuietHours(settings, date=new Date()) {
  if (!settings.quietStart || !settings.quietEnd || settings.quietStart === settings.quietEnd) return false;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:env.TIME_ZONE||"Asia/Makassar",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(date);
  return settings.quietStart < settings.quietEnd ? parts>=settings.quietStart && parts<settings.quietEnd : parts>=settings.quietStart || parts<settings.quietEnd;
}
async function ingest() {
  const release = await store.acquireIngestionLock();
  if (!release) return null;
  try {
    const reading = await fetchCurrent({ token:env.AIRGRADIENT_API_TOKEN, locationId:env.AIRGRADIENT_LOCATION_ID });
    await store.saveReading(reading);
    const settings=await runtimeSettings(), current=await store.alertState();
    const result=evaluateAlert({ current,pm25:reading.pm25,timestamp:reading.timestamp,settings });
    if (result.event) {
      // Keep the prior state while quiet so the transition is delivered on the next eligible poll.
      if (isQuietHours(settings)) return reading;
      const eventKey=`${result.event}:${reading.timestamp}`;
      if (!await store.eventSeen(eventKey)) {
        await notify({ event:result.event,reading,settings,store,env });
        await store.updateAlertState(result.next,eventKey);
        return reading;
      }
    }
    await store.updateAlertState(result.next);
    return reading;
  } finally {
    await release();
  }
}

app.get("/health", (_req,res)=>res.json({ok:true}));
app.get("/api/cron/ingest", async (req,res) => { if (!safeEqual(req.get("authorization"),`Bearer ${env.CRON_SECRET}`)) return res.sendStatus(401); try { const reading=await ingest(); res.json({ok:true,timestamp:reading?.timestamp||null,skipped:!reading}); } catch(error) { console.error("Ingestion failed:",error.message); res.status(502).json({ok:false,error:"Ingestion failed"}); } });
app.post("/api/webhook/notify", async (req,res) => { if (!env.WEBHOOK_SECRET) return res.status(503).json({error:"Webhook notifications are not configured"}); if (!safeEqual(req.get("authorization"),`Bearer ${env.WEBHOOK_SECRET}`)) return res.sendStatus(401); const title=String(req.body?.title||"Air monitor notification").slice(0,120),body=String(req.body?.body||"").slice(0,500),requestedUrl=String(req.body?.url||"/"),url=requestedUrl.startsWith("/")?requestedUrl:"/"; if(!body)return res.status(400).json({error:"body is required"}); try{await sendPush({title,body,url,store,env});res.json({ok:true});}catch(error){res.status(503).json({error:error.message});} });
app.use(auth);
app.post("/api/ingest-now", async (_req,res) => { try { const reading=await ingest(); res.json({ok:true,timestamp:reading?.timestamp||null,skipped:!reading}); } catch(error) { console.error("Manual ingestion failed:",error.message); res.status(502).json({ok:false,error:"Ingestion failed"}); } });
app.get("/api/dashboard", async (_req,res) => { const latest=await store.latest(), settings=await runtimeSettings(); const since=new Date(Date.now()-86400000).toISOString(); res.json({ appName:env.APP_NAME||"Air monitor",locationLabel:env.LOCATION_LABEL||"MY HOME",latest, history:await store.history(since), freshness:dataFreshness(latest?.timestamp,new Date(),settings.staleMinutes,settings.offlineMinutes), alert:await store.alertState(), settings, timeZone:env.TIME_ZONE||"Etc/UTC", pushAvailable:Boolean(env.VAPID_PUBLIC_KEY) }); });
app.put("/api/settings", async (req,res) => { const s=req.body; if (![s.alertThreshold,s.clearThreshold,s.durationMinutes].every(Number.isFinite) || s.clearThreshold>=s.alertThreshold || s.durationMinutes<0 || !["push","email"].includes(s.channel)) return res.status(400).json({error:"Check thresholds, duration, and channel"}); await store.updateSettings(s); res.json({ok:true}); });
app.get("/api/push-key", (_req,res)=>res.json({publicKey:env.VAPID_PUBLIC_KEY||null}));
app.post("/api/push-subscription", async (req,res)=> { if (!req.body?.endpoint || !req.body?.keys) return res.status(400).json({error:"Invalid subscription"}); await store.saveSubscription(req.body); res.status(201).json({ok:true}); });
app.post("/api/test-notification", async (_req,res)=> { try { const reading=await store.latest()||{pm25:"—"}; await notify({event:"alert",reading,settings:await runtimeSettings(),store,env}); res.json({ok:true}); } catch(error) { res.status(503).json({error:error.message}); } });
app.use(express.static(path.join(here,"../public"),{maxAge:"1h"}));
app.get("/{*splat}", (_req,res)=>res.sendFile(path.join(here,"../public/index.html")));

const port=Number(env.PORT||3000);
if (!env.VERCEL) app.listen(port,()=>console.log(`Air alert listening on ${port}`));
if (env.ENABLE_INTERNAL_POLLING === "true") { ingest().catch(e=>console.error("Ingestion failed:",e.message)); setInterval(()=>ingest().catch(e=>console.error("Ingestion failed:",e.message)),Number(env.POLL_INTERVAL_SECONDS||300)*1000).unref(); }

export default app;
