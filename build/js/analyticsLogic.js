const SOCIAL_HOSTS = [
  ['tiktok', ['tiktok.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['x', ['x.com', 'twitter.com', 't.co']],
  ['reddit', ['reddit.com', 'redd.it']]
];

export function classifyTraffic({ href = '', referrer = '' } = {}) {
  let campaign = '';
  try { campaign = new URL(href).searchParams.get('utm_source')?.toLowerCase() || ''; } catch {}
  for (const [source, aliases] of SOCIAL_HOSTS) if (aliases.some(alias => campaign.includes(alias.split('.')[0]))) return source;
  let hostname = '';
  try { hostname = new URL(referrer).hostname.toLowerCase(); } catch {}
  for (const [source, hosts] of SOCIAL_HOSTS) if (hosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) return source;
  return hostname ? 'other' : 'direct';
}

export function retentionMilestones(firstSeen, now, reported = {}) {
  const days = Math.floor(Math.max(0, now - firstSeen) / 86400000), due = [];
  if (days >= 1 && !reported.day1) due.push('day_1');
  if (days >= 7 && !reported.day7) due.push('day_7');
  return due;
}

export function durationBand(seconds) {
  if (seconds < 10) return 'under_10s';
  if (seconds < 30) return '10_29s';
  if (seconds < 60) return '30_59s';
  if (seconds < 180) return '1_3m';
  if (seconds < 600) return '3_10m';
  return '10m_plus';
}

export function loadBand(milliseconds) {
  if (milliseconds < 500) return 'under_500ms';
  if (milliseconds < 1000) return '500_999ms';
  if (milliseconds < 2000) return '1_2s';
  if (milliseconds < 3000) return '2_3s';
  return 'over_3s';
}
