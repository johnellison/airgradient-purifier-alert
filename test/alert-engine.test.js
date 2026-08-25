import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlert, dataFreshness } from "../src/alert-engine.js";

const settings={alertThreshold:35,clearThreshold:25,durationMinutes:10,staleMinutes:10,offlineMinutes:30};
const normal={status:"normal",pendingSince:null,changedAt:null};
const run=(current,pm25,minute,now=minute)=>evaluateAlert({current,pm25,timestamp:`2026-08-25T00:${String(minute).padStart(2,"0")}:00Z`,settings,now:new Date(`2026-08-25T00:${String(now).padStart(2,"0")}:00Z`)});
test("alerts once after a sustained crossing",()=>{ const pending=run(normal,40,0).next; const alert=run(pending,40,10); assert.equal(alert.event,"alert"); assert.equal(run(alert.next,41,11).event,null); });
test("hysteresis prevents clearing above clear threshold",()=>{ const active={status:"alert",pendingSince:null,changedAt:null}; assert.equal(run(active,30,1).next.status,"alert"); assert.equal(run(active,25,2).event,"clear"); });
test("a dip resets pending duration",()=>{ const pending=run(normal,40,0).next; assert.equal(run(pending,34,5).next.status,"normal"); });
test("stale data never changes alert state",()=>{ const result=run(normal,80,0,20); assert.equal(result.next,normal); assert.equal(result.freshness.state,"stale"); });
test("offline and missing timestamps are explicit",()=>{ assert.equal(dataFreshness("2026-08-25T00:00:00Z",new Date("2026-08-25T00:31:00Z"),10,30).state,"offline"); assert.equal(dataFreshness(null,new Date(),10,30).state,"offline"); });
