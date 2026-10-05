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
  ['tanks',   'Delivery frequency',     20],
  ['message', 'Comments',             2000]
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

  /* when it arrived, in the business's own time zone (Brisbane) */
  var when = '';
  try {
    when = new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true
    }) + ' Brisbane time';
  } catch (e) {}

  var text = 'New website enquiry' + (when ? '\nReceived ' + when : '') + '\n\n' +
    rows.map(function (f) { return f[1] + ': ' + data[f[0]]; }).join('\n') +
    '\n\n\u2014 sent from the Fuel 2 Go website. Reply to this email to answer the sender directly.';

  /* ---------------------------------------------------------------------------------------
     The email. Built the way mail clients need it: tables, inline styles, a bgcolor beside
     every background (Outlook ignores CSS backgrounds), and nothing that depends on images.
     Outlook and others block remote images until the reader allows them, so the logo and
     hero are decoration on top of a layout that is complete without them: every image has
     a navy backing and alt text, and all the information is live text.
     Brand colours from the site: navy #030D30, gold #E8A33D, ivory #F4F3EF,
     silver #A7A9AC, steel #6D6E71.
     --------------------------------------------------------------------------------------- */
  var NAVY = '#030D30', GOLD = '#E8A33D', IVORY = '#F4F3EF', SILVER = '#A7A9AC', STEEL = '#6D6E71';
  var FONT = 'Arial,Helvetica,sans-serif';
  var SITE = 'https://www.fuel2go.com.au';
  var who = data.company || data.name;

  /* links built from visitor input are made safe: the address cannot smuggle ?bcc= into a
     mailto, and the phone link keeps digits and a leading + only */
  var mailAddr = encodeURIComponent(data.email).replace(/%40/g, '@');
  var telDigits = data.phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  var canCall = telDigits.replace(/\D/g, '').length >= 6;
  var replyHref = 'mailto:' + mailAddr + '?subject=' + encodeURIComponent('Re: your Fuel 2 Go enquiry');

  /* the line a phone shows in the inbox list before the email is opened */
  var preview = [
    data.company ? data.name : '',
    data.volume ? data.volume + ' L a month' : '',
    data.tanks || '',
    data.region, data.product
  ].filter(Boolean).join(' \u00B7 ') || 'New website enquiry';
  var pad = ''; for (var z = 0; z < 60; z++) pad += '&zwnj;&nbsp;';

  /* at a glance: the three numbers a salesperson wants first */
  var glance = [
    ['Needs', data.product],
    ['Diesel a month', data.volume ? data.volume + ' L' : ''],
    ['Delivery', data.tanks]
  ].filter(function (g) { return g[1]; });
  var glanceHtml = '';
  if (glance.length) {
    var w = Math.floor(100 / glance.length);
    /* equal-height boxes: when any value is long enough to wrap, give every box the two-line height */
    var boxH = glance.some(function (g) { return g[1].length > 14; }) ? 92 : 68;
    glanceHtml = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>' +
      glance.map(function (g, i) {
        return '<td class="stack" width="' + w + '%" valign="top" style="width:' + w + '%;padding:0 ' + (i === glance.length - 1 ? '0' : '8px') + ' 0 0">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          '<td class="cell" height="' + boxH + '" valign="top" bgcolor="' + IVORY + '" style="background:' + IVORY + ';border-top:3px solid ' + GOLD + ';padding:12px 14px 13px;height:' + boxH + 'px">' +
            '<div style="font-family:' + FONT + ';font-size:10px;line-height:14px;letter-spacing:1.8px;text-transform:uppercase;color:' + STEEL + '">' + esc(g[0]) + '</div>' +
            '<div style="font-family:' + FONT + ';font-size:18px;line-height:23px;font-weight:bold;color:' + NAVY + ';padding-top:3px">' + esc(g[1]) + '</div>' +
          '</td></tr></table></td>';
      }).join('') + '</tr></table>';
  }

  /* contact details, each one a tap away on a phone */
  var linkStyle = 'color:' + NAVY + ';text-decoration:underline';
  var contact = [
    ['Name', esc(data.name)],
    ['Company', esc(data.company)],
    ['Phone', canCall ? '<a href="tel:' + esc(telDigits) + '" style="' + linkStyle + '">' + esc(data.phone) + '</a>' : esc(data.phone)],
    ['Email', '<a href="mailto:' + mailAddr + '" style="' + linkStyle + '">' + esc(data.email) + '</a>'],
    ['Region', esc(data.region)]
  ].filter(function (r) { return r[1]; });
  var contactHtml = contact.map(function (r, i) {
    var rule = i === contact.length - 1 ? '' : 'border-bottom:1px solid #E4E2DA;';
    return '<tr>' +
      '<td valign="top" style="padding:11px 16px 11px 0;' + rule + 'font-family:' + FONT + ';font-size:11px;line-height:20px;letter-spacing:1.6px;' +
        'text-transform:uppercase;color:' + STEEL + ';white-space:nowrap;width:96px">' + esc(r[0]) + '</td>' +
      '<td valign="top" style="padding:11px 0;' + rule + 'font-family:' + FONT + ';font-size:15px;line-height:20px;color:' + NAVY + '">' + r[1] + '</td></tr>';
  }).join('');

  var notesHtml = data.message
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0"><tr>' +
      '<td bgcolor="' + IVORY + '" style="background:' + IVORY + ';border-left:3px solid ' + GOLD + ';padding:14px 18px 16px">' +
        '<div style="font-family:' + FONT + ';font-size:10px;line-height:14px;letter-spacing:1.8px;text-transform:uppercase;color:' + STEEL + '">Their notes</div>' +
        '<div style="font-family:' + FONT + ';font-size:15px;line-height:23px;color:' + NAVY + ';padding-top:5px;white-space:pre-wrap">' + esc(data.message) + '</div>' +
      '</td></tr></table>'
    : '';

  var btn = 'display:inline-block;padding:14px 26px;font-family:' + FONT + ';font-size:13px;line-height:16px;font-weight:bold;' +
            'letter-spacing:1.6px;text-transform:uppercase;text-decoration:none;text-align:center';
  var buttonsHtml = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0"><tr>' +
    '<td bgcolor="' + GOLD + '" style="background:' + GOLD + ';border:2px solid ' + GOLD + '">' +
      '<a href="' + replyHref + '" style="' + btn + ';color:' + NAVY + '">Reply to this enquiry</a></td>' +
    (canCall
      ? '<td width="10" style="width:10px;font-size:0">&nbsp;</td>' +
        '<td style="border:2px solid ' + NAVY + '"><a href="tel:' + esc(telDigits) + '" style="' + btn + ';color:' + NAVY + '">Call ' + esc(data.phone) + '</a></td>'
      : '') +
    '</tr></table>';

  var html =
    '<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    '<title>New website enquiry</title>' +
    '<style>@media only screen and (max-width:480px){.stack{display:block!important;width:100%!important;padding:0 0 8px!important}.cell{height:auto!important}.pad{padding-left:20px!important;padding-right:20px!important}}</style>' +
    '</head><body style="margin:0;padding:0;background:' + IVORY + '" bgcolor="' + IVORY + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:' + IVORY + '">' + esc(preview) + pad + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + IVORY + '" style="background:' + IVORY + '">' +
    '<tr><td align="center" style="padding:24px 12px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">' +

        /* logo bar */
        '<tr><td class="pad" bgcolor="' + NAVY + '" style="background:' + NAVY + ';padding:22px 32px 18px">' +
          '<img src="' + SITE + '/assets/logo-white.png" width="160" height="19" alt="FUEL 2 GO" ' +
            'style="display:block;border:0;outline:none;width:160px;height:auto;font-family:' + FONT + ';font-size:20px;line-height:20px;font-weight:bold;font-style:italic;color:#FFFFFF;letter-spacing:1px">' +
        '</td></tr>' +

        /* hero image: navy backing so a blocked image reads as a clean band, not a broken icon */
        '<tr><td bgcolor="' + NAVY + '" style="background:' + NAVY + ';font-size:0;line-height:0">' +
          '<img src="' + SITE + '/assets/email-hero.jpg" width="600" height="260" alt="A Fuel 2 Go tanker on the open road at dusk" ' +
            'style="display:block;border:0;outline:none;width:100%;max-width:600px;height:auto;font-family:' + FONT + ';font-size:13px;line-height:18px;color:' + SILVER + '">' +
        '</td></tr>' +

        /* hero text */
        '<tr><td class="pad" bgcolor="' + NAVY + '" style="background:' + NAVY + ';padding:26px 32px 28px;border-bottom:4px solid ' + GOLD + '">' +
          '<div style="font-family:' + FONT + ';font-size:11px;line-height:16px;letter-spacing:2.6px;text-transform:uppercase;color:' + GOLD + ';font-weight:bold">New website enquiry</div>' +
          '<div style="font-family:' + FONT + ';font-size:30px;line-height:35px;font-weight:bold;color:#FFFFFF;padding-top:8px">' + esc(who) + '</div>' +
          '<div style="font-family:' + FONT + ';font-size:13px;line-height:19px;color:' + SILVER + ';padding-top:6px">' +
            esc(data.name) + (when ? ' &nbsp;\u00B7&nbsp; ' + esc(when) : '') + '</div>' +
        '</td></tr>' +

        /* body */
        '<tr><td class="pad" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:28px 32px 30px">' +
          glanceHtml +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ' + SILVER + '">' + contactHtml + '</table>' +
          notesHtml +
          buttonsHtml +
        '</td></tr>' +

        /* footer */
        '<tr><td class="pad" bgcolor="' + NAVY + '" style="background:' + NAVY + ';padding:18px 32px 20px">' +
          '<div style="font-family:' + FONT + ';font-size:12px;line-height:18px;color:' + SILVER + '">' +
            'Sent from the Fuel 2 Go website. Replying to this email goes straight to the sender.</div>' +
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
