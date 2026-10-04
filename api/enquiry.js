/* POST /api/enquiry
   Receives the website enquiry form and emails it through Resend's REST API.
   No SDK and no build step: Vercel runs this file as-is.

   Environment variables (set in Vercel -> Project -> Settings -> Environment Variables):
     RESEND_API_KEY   required. Never commit it; .env files are git- and vercel-ignored.
     ENQUIRY_TO       optional. Where enquiries go.            default: admin@fuel2go.com.au
     ENQUIRY_FROM     optional. The sender, on a domain you have verified in Resend.
                      default: Fuel 2 Go Website <enquiries@fuel2go.com.au>

   Until fuel2go.com.au is verified in Resend, Resend refuses that sender. To test before
   then, set ENQUIRY_FROM to "Fuel 2 Go Website <onboarding@resend.dev>" and ENQUIRY_TO to
   the email address your Resend account was created with. Resend only delivers the shared
   test sender to that one address.

   If anything here fails, the page falls back to opening the visitor's mail app, so a
   missing key or an outage never loses an enquiry. */

var DEFAULT_TO = 'admin@fuel2go.com.au';
var DEFAULT_FROM = 'Fuel 2 Go Website <enquiries@fuel2go.com.au>';

/* label, max length. Order is the order they appear in the email. */
var FIELDS = [
  ['name',    'Name',                  120],
  ['company', 'Company',               160],
  ['phone',   'Phone',                  40],
  ['email',   'Email',                 200],
  ['region',  'State / region',         40],
  ['product', 'Requirement',            80],
  ['volume',  'Diesel per month (L)',   40],
  ['tanks',   'Tanks required',         20],
  ['message', 'Notes',                2000]
];
var REQUIRED = ['name', 'company', 'phone', 'email'];
var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clean(v, max) {
  /* strings only, no control characters, trimmed and capped */
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function oneLine(v) {
  /* anything that ends up in a header must not be able to carry a line break */
  return v.replace(/[\r\n]+/g, ' ');
}

function esc(v) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  var b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (typeof b === 'string' || Buffer.isBuffer(b)) {
    try { return JSON.parse(b.toString()); } catch (e) { return null; }
  }
  return null;
}

function sameOrigin(req) {
  /* A browser always sends Origin on a cross-site POST. Refuse any that is not this site. */
  var origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!sameOrigin(req)) return send(res, 403, { ok: false, error: 'forbidden' });

  var raw = parseBody(req);
  if (!raw) return send(res, 400, { ok: false, error: 'bad_request' });

  /* honeypot: a real visitor never fills this. Say "ok" so a bot learns nothing. */
  if (typeof raw.company_website === 'string' && raw.company_website.trim()) {
    return send(res, 200, { ok: true });
  }

  var data = {};
  FIELDS.forEach(function (f) { data[f[0]] = clean(raw[f[0]], f[2]); });

  for (var i = 0; i < REQUIRED.length; i++) {
    if (!data[REQUIRED[i]]) return send(res, 400, { ok: false, error: 'missing_' + REQUIRED[i] });
  }
  if (!EMAIL_RE.test(data.email)) return send(res, 400, { ok: false, error: 'bad_email' });

  var key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('enquiry: RESEND_API_KEY is not set');
    return send(res, 500, { ok: false, error: 'not_configured' });
  }

  var rows = FIELDS.filter(function (f) { return data[f[0]]; });
  var text = 'New website enquiry\n\n' +
    rows.map(function (f) { return f[1] + ': ' + data[f[0]]; }).join('\n') +
    '\n\n— sent from the Fuel 2 Go website';
  /* Brand colours, from the site's own tokens: navy #030D30, gold #E8A33D, ivory #F4F3EF,
     silver #A7A9AC, steel #6D6E71. Email clients ignore <style> blocks and CSS variables, so
     everything is inline, laid out in tables, with a bgcolor fallback beside every background. */
  var NAVY = '#030D30', GOLD = '#E8A33D', IVORY = '#F4F3EF', SILVER = '#A7A9AC', STEEL = '#6D6E71';
  var FONT = "Arial,Helvetica,sans-serif";
  var who = data.company || data.name;

  var tableRows = rows.map(function (f, i) {
    var rule = i === rows.length - 1 ? '' : 'border-bottom:1px solid #E4E2DA;';
    return '<tr>' +
      '<td valign="top" style="padding:16px 18px 12px 0;' + rule + 'font-family:' + FONT + ';font-size:11px;' +
        'letter-spacing:1.6px;text-transform:uppercase;color:' + STEEL + ';white-space:nowrap;width:150px">' + esc(f[1]) + '</td>' +
      '<td valign="top" style="padding:12px 0;' + rule + 'font-family:' + FONT + ';font-size:15px;line-height:22px;' +
        'color:' + NAVY + ';white-space:pre-wrap">' + esc(data[f[0]]) + '</td></tr>';
  }).join('');

  var html =
    '<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    '</head><body style="margin:0;padding:0;background:' + IVORY + '" bgcolor="' + IVORY + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + IVORY + '" style="background:' + IVORY + '">' +
    '<tr><td align="center" style="padding:28px 14px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">' +
        /* header band */
        '<tr><td bgcolor="' + NAVY + '" style="background:' + NAVY + ';padding:26px 32px 22px">' +
          '<img src="https://www.fuel2go.com.au/assets/logo-white.png" width="150" alt="FUEL 2 GO" ' +
            'style="display:block;border:0;outline:none;font-family:' + FONT + ';font-size:20px;font-weight:bold;color:#FFFFFF;letter-spacing:1px">' +
        '</td></tr>' +
        /* gold rule */
        '<tr><td height="4" bgcolor="' + GOLD + '" style="background:' + GOLD + ';height:4px;font-size:0;line-height:0">&nbsp;</td></tr>' +
        /* body */
        '<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:30px 32px 26px">' +
          '<div style="font-family:' + FONT + ';font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:' + GOLD + ';font-weight:bold">New website enquiry</div>' +
          '<div style="font-family:' + FONT + ';font-size:26px;line-height:30px;font-weight:bold;color:' + NAVY + ';padding:8px 0 4px">' + esc(who) + '</div>' +
          '<div style="font-family:' + FONT + ';font-size:14px;line-height:20px;color:' + STEEL + ';padding-bottom:20px">' +
            esc(data.name) + '</div>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ' + SILVER + '">' + tableRows + '</table>' +
          /* reply button */
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px"><tr>' +
            '<td bgcolor="' + GOLD + '" style="background:' + GOLD + '">' +
              '<a href="mailto:' + esc(data.email) + '?subject=' + encodeURIComponent('Re: ' + 'Your Fuel 2 Go enquiry') + '" ' +
                'style="display:inline-block;padding:13px 26px;font-family:' + FONT + ';font-size:13px;font-weight:bold;' +
                'letter-spacing:1.6px;text-transform:uppercase;color:' + NAVY + ';text-decoration:none">Reply to ' + esc(data.name.split(' ')[0] || 'sender') + '</a>' +
            '</td></tr></table>' +
        '</td></tr>' +
        /* footer */
        '<tr><td bgcolor="' + NAVY + '" style="background:' + NAVY + ';padding:18px 32px">' +
          '<div style="font-family:' + FONT + ';font-size:12px;line-height:18px;color:' + SILVER + '">' +
            'Sent from the Fuel 2 Go website. Replying to this email also goes straight to the sender.</div>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr></table></body></html>';

  var payload = {
    from: process.env.ENQUIRY_FROM || DEFAULT_FROM,
    to: [process.env.ENQUIRY_TO || DEFAULT_TO],
    reply_to: data.email,
    subject: oneLine('Website enquiry — ' + (data.company || data.name)).slice(0, 200),
    text: text,
    html: html
  };

  var upstream;
  try {
    upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('enquiry: could not reach Resend:', e && e.message);
    return send(res, 502, { ok: false, error: 'send_failed' });
  }

  if (!upstream.ok) {
    /* log Resend's reason (domain not verified, bad sender, quota) but never show it to the visitor */
    var detail = '';
    try { detail = await upstream.text(); } catch (e) {}
    console.error('enquiry: Resend returned ' + upstream.status + ' ' + detail.slice(0, 400));
    return send(res, 502, { ok: false, error: 'send_failed' });
  }

  return send(res, 200, { ok: true });
};
