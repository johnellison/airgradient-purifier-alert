import webpush from "web-push";

export function configurePush(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@example.com", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export async function sendPush({ title, body, url="/", store, env }) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error("Push notifications are not configured");
  const subscriptions = await store.subscriptions();
  if (!subscriptions.length) throw new Error("Enable notifications on a device first");
  const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
    try { await webpush.sendNotification(subscription, JSON.stringify({ title, body, url })); }
    catch (error) { if (error.statusCode === 404 || error.statusCode === 410) await store.removeSubscription(subscription.endpoint); else throw error; }
  }));
  if (!results.some((result) => result.status === "fulfilled")) throw new Error("Push delivery failed");
}

export async function notify({ event, reading, settings, store, env }) {
  const title = event === "alert" ? "Turn on purifier" : "Air improving";
  const body = event === "alert" ? `PM2.5 is ${reading.pm25} µg/m³ after a sustained rise.` : `PM2.5 is back to ${reading.pm25} µg/m³.`;
  if (settings.channel === "email") {
    if (!env.RESEND_API_KEY || !(settings.recipient || env.EMAIL_TO)) throw new Error("Email notifications are not configured");
    const response = await fetch("https://api.resend.com/emails", { method:"POST", headers:{ authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json" }, body:JSON.stringify({ from:env.EMAIL_FROM,to:[settings.recipient || env.EMAIL_TO],subject:title,text:body }) });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
    return;
  }
  await sendPush({ title, body, store, env });
}
