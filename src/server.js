import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { fetchCurrent } from "./airgradient.js";
import { createStore } from "./store.js";
import { configurePush, notify } from "./notifications.js";
import { dataFreshness, evaluateAlert } from "./alert-engine.js";

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(env.DATABASE_PATH || "./data/airgradient.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive:true });
const store = createStore(dbPath);
configurePush(env);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit:"20kb" }));

function safeEqual(a, b) { const x=Buffer.from(a||""); const y=Buffer.from(b||""); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function auth(req,res,next) {
  const password=env.APP_PASSWORD;
  if (!password) return res.status(503).send("APP_PASSWORD is not configured");
  const [scheme,encoded] = (req.headers.authorization||"").split(" ");
  const supplied = scheme === "Basic" && encoded ? Buffer.from(encoded,"base64").toString().split(":").slice(1).join(":") : "";
  if (!safeEqual(supplied,password)) { res.set("WWW-Authenticate",'Basic realm="Air at home", charset="UTF-8"'); return res.status(401).send("Authentication required"); }
  next();
}

const runtimeSettings = () => ({ ...store.settings(), staleMinutes:Number(env.STALE_AFTER_MINUTES||10), offlineMinutes:Number(env.OFFLINE_AFTER_MINUTES||30) });
function isQuietHours(settings, date=new Date()) {
  if (!settings.quietStart || !settings.quietEnd || settings.quietStart === settings.quietEnd) return false;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:env.TIME_ZONE||"Asia/Makassar",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(date);
  return settings.quietStart < settings.quietEnd ? parts>=settings.quietStart && parts<settings.quietEnd : parts>=settings.quietStart || parts<settings.quietEnd;
}
async function ingest() {
  const reading = await fetchCurrent({ token:env.AIRGRADIENT_API_TOKEN, locationId:env.AIRGRADIENT_LOCATION_ID });
  store.saveReading(reading);
  const settings=runtimeSettings(), current=store.alertState();
  const result=evaluateAlert({ current,pm25:reading.pm25,timestamp:reading.timestamp,settings });
  if (result.event) {
    // Keep the prior state while quiet so the transition is delivered on the next eligible poll.
    if (isQuietHours(settings)) return reading;
    const eventKey=`${result.event}:${reading.timestamp}`;
    if (!store.eventSeen(eventKey)) {
      await notify({ event:result.event,reading,settings,store,env });
      store.updateAlertState(result.next,eventKey);
      return reading;
    }
  }
  store.updateAlertState(result.next);
  return reading;
}

app.get("/health", (_req,res)=>res.json({ok:true}));
app.post("/api/cron/ingest", async (req,res) => { if (!safeEqual(req.get("x-cron-secret"),env.CRON_SECRET)) return res.sendStatus(401); try { res.json({ok:true,timestamp:(await ingest()).timestamp}); } catch(error) { console.error("Ingestion failed:",error.message); res.status(502).json({ok:false,error:"Ingestion failed"}); } });
app.use(auth);
app.get("/api/dashboard", (_req,res) => { const latest=store.latest(), settings=runtimeSettings(); const since=new Date(Date.now()-86400000).toISOString(); res.json({ latest, history:store.history(since), freshness:dataFreshness(latest?.timestamp,new Date(),settings.staleMinutes,settings.offlineMinutes), alert:store.alertState(), settings, timeZone:env.TIME_ZONE||"Asia/Makassar", pushAvailable:Boolean(env.VAPID_PUBLIC_KEY) }); });
app.put("/api/settings", (req,res) => { const s=req.body; if (![s.alertThreshold,s.clearThreshold,s.durationMinutes].every(Number.isFinite) || s.clearThreshold>=s.alertThreshold || s.durationMinutes<0 || !["push","email"].includes(s.channel)) return res.status(400).json({error:"Check thresholds, duration, and channel"}); store.updateSettings(s); res.json({ok:true}); });
app.get("/api/push-key", (_req,res)=>res.json({publicKey:env.VAPID_PUBLIC_KEY||null}));
app.post("/api/push-subscription", (req,res)=> { if (!req.body?.endpoint || !req.body?.keys) return res.status(400).json({error:"Invalid subscription"}); store.saveSubscription(req.body); res.status(201).json({ok:true}); });
app.post("/api/test-notification", async (_req,res)=> { try { const reading=store.latest()||{pm25:"—"}; await notify({event:"alert",reading,settings:runtimeSettings(),store,env}); res.json({ok:true}); } catch(error) { res.status(503).json({error:error.message}); } });
app.use(express.static(path.join(here,"../public"),{maxAge:"1h"}));
app.get("/{*splat}", (_req,res)=>res.sendFile(path.join(here,"../public/index.html")));

const port=Number(env.PORT||3000);
app.listen(port,()=>console.log(`Air alert listening on ${port}`));
if (env.ENABLE_INTERNAL_POLLING === "true") { ingest().catch(e=>console.error("Ingestion failed:",e.message)); setInterval(()=>ingest().catch(e=>console.error("Ingestion failed:",e.message)),Number(env.POLL_INTERVAL_SECONDS||300)*1000).unref(); }
