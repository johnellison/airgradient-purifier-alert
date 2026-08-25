import test from "node:test";
import assert from "node:assert/strict";
import { fetchCurrent, normalizeReading } from "../src/airgradient.js";
test("normalizes documented corrected fields",()=>{ const r=normalizeReading({locationId:42,timestamp:"2026-08-25T00:00:00Z",pm02:9,pm02_corrected:7,atmp_corrected:27,rhum_corrected:61,rco2_corrected:430,tvocIndex:12,noxIndex:4},42); assert.deepEqual([r.pm25,r.temperature,r.humidity,r.co2,r.tvoc,r.nox],[7,27,61,430,12,4]); });
test("API failure is sanitized",async()=>{ await assert.rejects(()=>fetchCurrent({token:"super-secret",locationId:"42",fetchImpl:async()=>{throw new Error("URL contained super-secret")}}),error=>error.message==="AirGradient request failed" && !error.message.includes("super-secret")); });
