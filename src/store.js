import Database from "better-sqlite3";

export function createStore(filename) {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS readings (timestamp TEXT PRIMARY KEY, location_id TEXT NOT NULL, pm25 REAL, co2 REAL, temperature REAL, humidity REAL, tvoc REAL, nox REAL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), alert_threshold REAL NOT NULL, clear_threshold REAL NOT NULL, duration_minutes INTEGER NOT NULL, channel TEXT NOT NULL, recipient TEXT, quiet_start TEXT, quiet_end TEXT);
    CREATE TABLE IF NOT EXISTS alert_state (id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL, pending_since TEXT, changed_at TEXT, last_event_key TEXT);
    CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES (1, 35, 25, 10, 'push', NULL, NULL, NULL);
    INSERT OR IGNORE INTO alert_state VALUES (1, 'normal', NULL, NULL, NULL);
  `);
  const insertReading = db.prepare(`INSERT OR IGNORE INTO readings VALUES (@timestamp,@locationId,@pm25,@co2,@temperature,@humidity,@tvoc,@nox)`);
  return {
    saveReading: (r) => insertReading.run(r),
    latest: () => db.prepare("SELECT timestamp, location_id locationId, pm25, co2, temperature, humidity, tvoc, nox FROM readings ORDER BY timestamp DESC LIMIT 1").get() ?? null,
    history: (since) => db.prepare("SELECT timestamp, pm25 FROM readings WHERE timestamp >= ? ORDER BY timestamp").all(since),
    settings: () => { const s=db.prepare("SELECT * FROM settings WHERE id=1").get(); return { alertThreshold:s.alert_threshold, clearThreshold:s.clear_threshold, durationMinutes:s.duration_minutes, channel:s.channel, recipient:s.recipient, quietStart:s.quiet_start, quietEnd:s.quiet_end }; },
    updateSettings: (s) => db.prepare("UPDATE settings SET alert_threshold=?,clear_threshold=?,duration_minutes=?,channel=?,recipient=?,quiet_start=?,quiet_end=? WHERE id=1").run(s.alertThreshold,s.clearThreshold,s.durationMinutes,s.channel,s.recipient||null,s.quietStart||null,s.quietEnd||null),
    alertState: () => { const s=db.prepare("SELECT * FROM alert_state WHERE id=1").get(); return { status:s.status,pendingSince:s.pending_since,changedAt:s.changed_at,lastEventKey:s.last_event_key }; },
    updateAlertState: (s, eventKey=null) => db.prepare("UPDATE alert_state SET status=?,pending_since=?,changed_at=?,last_event_key=COALESCE(?,last_event_key) WHERE id=1").run(s.status,s.pendingSince,s.changedAt,eventKey),
    eventSeen: (key) => db.prepare("SELECT 1 FROM alert_state WHERE id=1 AND last_event_key=?").get(key) != null,
    saveSubscription: (sub) => db.prepare("INSERT OR REPLACE INTO subscriptions VALUES (?,?,?)").run(sub.endpoint,JSON.stringify(sub),new Date().toISOString()),
    subscriptions: () => db.prepare("SELECT payload FROM subscriptions").all().map(x=>JSON.parse(x.payload)),
    removeSubscription: (endpoint) => db.prepare("DELETE FROM subscriptions WHERE endpoint=?").run(endpoint),
    close: () => db.close()
  };
}
