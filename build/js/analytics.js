import { classifyTraffic, retentionMilestones, durationBand, loadBand } from './analyticsLogic.js';

const MEASUREMENT_ID = 'G-DDJ5VFPKPK';
const CONSENT_KEY = 'chainRushAnalyticsConsent';
const VISIT_KEY = 'chainRushAnalyticsVisit';
const sessionStartedAt = performance.now();
let consent = read(CONSENT_KEY), sessionReported = false, scriptLoaded = false, pendingLoad = null;

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch {} }
function gtag(...args) { window.dataLayer = window.dataLayer || []; window.dataLayer.push(args); }
function configured() { return /^G-[A-Z0-9]{8,}$/.test(MEASUREMENT_ID) && !MEASUREMENT_ID.includes('REPLACE'); }

function sanitizedLocation() {
  try {
    const url = new URL(location.href), allowed = new URLSearchParams();
    for (const key of ['utm_source','utm_medium','utm_campaign']) if (url.searchParams.has(key)) allowed.set(key, url.searchParams.get(key).slice(0, 80));
    url.search = allowed.toString(); url.hash = ''; return url.toString();
  } catch { return location.origin + location.pathname; }
}

function referrerOrigin() { try { return document.referrer ? new URL(document.referrer).origin : ''; } catch { return ''; } }

function injectGoogleTag() {
  if (document.getElementById('ga4-tag')) return;
  const script = document.createElement('script'); script.id = 'ga4-tag'; script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`; document.head.append(script);
}

function loadProvider() {
  if (consent !== 'granted' || !configured()) return;
  window[`ga-disable-${MEASUREMENT_ID}`] = false;
  if (scriptLoaded) {
    gtag('consent', 'update', { analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied' });
    return;
  }
  scriptLoaded = true;
  gtag('consent', 'default', { analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied', wait_for_update:500 });
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, {
    send_page_view:true,
    page_location:sanitizedLocation(),
    page_referrer:referrerOrigin(),
    allow_google_signals:false,
    allow_ad_personalization_signals:false,
    cookie_expires:7776000,
    cookie_update:true,
    debug_mode:new URLSearchParams(location.search).get('analytics_debug') === '1'
  });
  injectGoogleTag(); reportVisit();
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
  if (consent !== 'granted' || !configured()) return;
  const clean = {};
  for (const [key, value] of Object.entries(data)) if (['string','number','boolean'].includes(typeof value)) clean[key.slice(0,40)] = typeof value === 'string' ? value.slice(0,100) : value;
  gtag('event', name.slice(0,40), clean);
}

export function reportLoad(milliseconds) {
  const data = { load_milliseconds:Math.max(0,Math.round(milliseconds)), load_band:loadBand(milliseconds) };
  if (consent === 'granted') track('game_loaded', data); else pendingLoad = data;
}
export function reportPerformance({ fps, quality, issue }) { track('performance_problem', { fps:Math.max(0,Math.round(fps)), quality, issue }); }

function reportSession() {
  if (sessionReported || consent !== 'granted') return; sessionReported = true;
  const seconds = Math.min(7200, Math.max(1, Math.round((performance.now() - sessionStartedAt) / 1000)));
  track('session_ended', { duration_seconds:seconds, duration_band:durationBand(seconds) });
}

function clearAnalyticsCookies() {
  const hostParts = location.hostname.split('.');
  const domains = ['', location.hostname, `.${location.hostname}`, hostParts.length > 2 ? `.${hostParts.slice(-2).join('.')}` : ''];
  document.cookie.split(';').map(item => item.split('=')[0].trim()).filter(name => name.startsWith('_ga')).forEach(name => {
    for (const domain of new Set(domains)) document.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ''} SameSite=Lax`;
  });
}

function updatePrivacyUI() {
  const label = document.querySelector('#privacy-setting b'); if (label) label.textContent = consent === 'granted' ? 'ON' : consent === 'denied' ? 'OFF' : 'ASK';
}
function showPrivacy() { document.querySelector('#privacy-consent')?.classList.add('show'); }
function hidePrivacy() { document.querySelector('#privacy-consent')?.classList.remove('show'); }
function setConsent(next) {
  if (next === 'denied' && consent === 'granted') reportSession();
  consent = next; write(CONSENT_KEY, next);
  if (next === 'granted') loadProvider();
  else {
    if (configured()) { gtag('consent', 'update', { analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied' }); window[`ga-disable-${MEASUREMENT_ID}`] = true; }
    clearAnalyticsCookies();
  }
  updatePrivacyUI(); hidePrivacy();
}

export function initAnalytics() {
  document.querySelector('#analytics-allow')?.addEventListener('click', () => setConsent('granted'));
  document.querySelector('#analytics-decline')?.addEventListener('click', () => setConsent('denied'));
  document.querySelector('#privacy-close')?.addEventListener('click', hidePrivacy);
  document.querySelector('#privacy-setting')?.addEventListener('click', showPrivacy);
  updatePrivacyUI();
  if (consent === 'granted') loadProvider(); else if (!consent) requestAnimationFrame(() => setTimeout(showPrivacy, 650));
  addEventListener('pagehide', reportSession);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reportSession(); });
  addEventListener('error', () => track('game_error', { error_type:'script_error' }));
  addEventListener('unhandledrejection', () => track('game_error', { error_type:'unhandled_rejection' }));
  return Object.freeze({ track, reportLoad, reportPerformance, consent:() => consent });
}
