import { classifyTraffic, retentionMilestones, durationBand, loadBand } from './analyticsLogic.js';

const CONSENT_KEY = 'chainRushAnalyticsConsent';
const VISIT_KEY = 'chainRushAnalyticsVisit';
const DISABLE_KEY = 'va-disable';
const sessionStartedAt = performance.now();
let consent = read(CONSENT_KEY), sessionReported = false, scriptsLoaded = false, pendingLoad = null;

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch {} }
function remove(key) { try { localStorage.removeItem(key); } catch {} }
function va(...args) { window.va?.(...args); }

function inject(src, id) {
  if (document.getElementById(id)) return;
  const script = document.createElement('script'); script.id = id; script.defer = true; script.src = src; document.head.append(script);
}

function safeUrl(event) {
  try {
    const url = new URL(event.url); const allowed = new URLSearchParams();
    for (const key of ['utm_source','utm_medium','utm_campaign']) if (url.searchParams.has(key)) allowed.set(key, url.searchParams.get(key).slice(0, 80));
    url.search = allowed.toString(); url.hash = ''; return { ...event, url:url.toString() };
  } catch { return event; }
}

function loadProviders() {
  if (scriptsLoaded || consent !== 'granted') return; scriptsLoaded = true;
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
  va('beforeSend', event => consent === 'granted' ? safeUrl(event) : null);
  inject('/_vercel/insights/script.js', 'vercel-analytics');
  inject('/_vercel/speed-insights/script.js', 'vercel-speed-insights');
  reportVisit();
  if (pendingLoad) { track('game_loaded', pendingLoad); pendingLoad = null; }
}

function reportVisit() {
  const now = Date.now(), previous = (() => { try { return JSON.parse(read(VISIT_KEY) || '{}'); } catch { return {}; } })();
  const firstSeen = Number(previous.firstSeen) || now, reported = previous.reported || {};
  track('traffic_source', { source:classifyTraffic({ href:location.href, referrer:document.referrer }) });
  for (const milestone of retentionMilestones(firstSeen, now, reported)) {
    track('return_visit', { milestone }); reported[milestone === 'day_1' ? 'day1' : 'day7'] = true;
  }
  write(VISIT_KEY, JSON.stringify({ firstSeen, lastSeen:now, reported }));
}

export function track(name, data = {}) {
  if (consent !== 'granted') return;
  const clean = {};
  for (const [key, value] of Object.entries(data)) if (['string','number','boolean'].includes(typeof value)) clean[key.slice(0,40)] = typeof value === 'string' ? value.slice(0,100) : value;
  va('event', { name:name.slice(0,80), data:clean });
}

export function reportLoad(milliseconds) {
  const data = { milliseconds:Math.max(0,Math.round(milliseconds)), band:loadBand(milliseconds) };
  if (consent === 'granted') track('game_loaded', data); else pendingLoad = data;
}
export function reportPerformance({ fps, quality, issue }) { track('performance_problem', { fps:Math.max(0,Math.round(fps)), quality, issue }); }

function reportSession() {
  if (sessionReported || consent !== 'granted') return; sessionReported = true;
  const seconds = Math.min(7200, Math.max(1, Math.round((performance.now() - sessionStartedAt) / 1000)));
  track('session_end', { seconds, band:durationBand(seconds) });
}

function updatePrivacyUI() {
  const label = document.querySelector('#privacy-setting b'); if (label) label.textContent = consent === 'granted' ? 'ON' : consent === 'denied' ? 'OFF' : 'ASK';
}
function showPrivacy() { document.querySelector('#privacy-consent')?.classList.add('show'); }
function hidePrivacy() { document.querySelector('#privacy-consent')?.classList.remove('show'); }
function setConsent(next) {
  if (next === 'denied' && consent === 'granted') reportSession();
  consent = next; write(CONSENT_KEY, next);
  if (next === 'granted') { remove(DISABLE_KEY); loadProviders(); } else write(DISABLE_KEY, '1');
  updatePrivacyUI(); hidePrivacy();
}

export function initAnalytics() {
  document.querySelector('#analytics-allow')?.addEventListener('click', () => setConsent('granted'));
  document.querySelector('#analytics-decline')?.addEventListener('click', () => setConsent('denied'));
  document.querySelector('#privacy-close')?.addEventListener('click', hidePrivacy);
  document.querySelector('#privacy-setting')?.addEventListener('click', showPrivacy);
  updatePrivacyUI();
  if (consent === 'granted') loadProviders(); else if (!consent) requestAnimationFrame(() => setTimeout(showPrivacy, 650));
  addEventListener('pagehide', reportSession);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reportSession(); });
  addEventListener('error', () => track('game_error', { type:'script_error' }));
  addEventListener('unhandledrejection', () => track('game_error', { type:'unhandled_rejection' }));
  return Object.freeze({ track, reportLoad, reportPerformance, consent:() => consent });
}
