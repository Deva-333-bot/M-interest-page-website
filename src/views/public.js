'use strict';
const { html, raw, esc, formatKES, formatPhone, whatsappLink, paragraphs, lines, SECTIONS } = require('../util');
const { CATEGORIES, METHODS } = require('../models/enquiries');

const hasLocation = (s) => Boolean(s.address || s.area);

function navLinks(s) {
  const links = [['/', 'Home'], ['/about', 'About'], ['/laundry', 'Laundry'], ['/cyber-cafe', 'Cyber café']];
  if (s.food_enabled) links.push(['/menu', 'Menu']);
  links.push(['/contact', 'Contact']);
  return links;
}

function waHref(s, text) { return whatsappLink(s.whatsapp_number, text); }
function waButton(s, label, text, cls = 'btn btn-primary') {
  const href = waHref(s, text);
  return href ? html`<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer">${label}<span class="sr-only"> (opens WhatsApp in a new tab)</span></a>` : '';
}
const telHref = (s) => (s.phone_number ? `tel:${s.phone_number}` : null);

function structuredData(s, cfg) {
  // Only emit what the owner has actually supplied; never invent address, geo, hours or ratings.
  if (!s.address && !s.phone_number) return '';
  const d = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: s.business_name, url: cfg.siteUrl + '/' };
  if (s.phone_number) d.telephone = s.phone_number;
  if (s.email) d.email = s.email;
  if (s.address) d.address = { '@type': 'PostalAddress', streetAddress: s.address, ...(s.area ? { addressLocality: s.area } : {}), addressCountry: 'KE' };
  const same = [s.facebook_url, s.instagram_url, s.tiktok_url].filter(Boolean);
  if (same.length) d.sameAs = same;
  return raw(`<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`);
}

function layout({ s, cfg, title, description, path = '/', body, noindex = false, structured = false }) {
  const fullTitle = path === '/' ? `${s.business_name}: laundry and cyber café services` : `${title} | ${s.business_name}`;
  const canonical = cfg.siteUrl + (path === '/' ? '/' : path);
  const links = navLinks(s);
  const wa = waHref(s, `Hello ${s.business_name}, I would like to make an enquiry.`);
  return html`<!doctype html>
<html lang="en" class="accent-${s.accent}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${noindex ? raw('<meta name="robots" content="noindex, follow">') : raw(`<link rel="canonical" href="${esc(canonical)}">`)}
<meta property="og:type" content="website"><meta property="og:site_name" content="${s.business_name}">
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#F4F4F6">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=1">
${structured ? structuredData(s, cfg) : ''}
<script src="/js/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="${s.business_name} home">${s.logo_path ? html`<img src="/uploads/${s.logo_path}" alt="${s.business_name}" height="40">` : html`<span class="brand-mark" aria-hidden="true"></span><span class="brand-name">${s.business_name}</span>`}</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="site-nav" aria-label="Main">
      <ul>${links.map(([href, label]) => html`<li><a href="${href}" ${href === path ? raw('aria-current="page"') : ''}>${label}</a></li>`)}</ul>
    </nav>
    ${wa ? html`<a class="btn btn-primary btn-sm head-cta" href="${wa}" target="_blank" rel="noopener noreferrer">WhatsApp us<span class="sr-only"> (opens in a new tab)</span></a>` : html`<a class="btn btn-primary btn-sm head-cta" href="/contact">Contact us</a>`}
  </div>
</header>
<main id="main" tabindex="-1">${body}</main>
${footer(s)}
</body>
</html>`;
}

function footer(s) {
  const links = navLinks(s);
  const hours = lines(s.opening_hours);
  return html`<footer class="site-footer">
  <div class="wrap foot-grid">
    <div>
      <p class="foot-brand">${s.business_name}</p>
      <p class="muted-on-dark">Laundry and cyber café services${s.area ? html` in ${s.area}` : ''}.</p>
    </div>
    <nav aria-label="Footer"><h2 class="foot-h">Pages</h2><ul class="plain">${links.map(([h, l]) => html`<li><a href="${h}">${l}</a></li>`)}<li><a href="/privacy">Privacy notice</a></li></ul></nav>
    <div>
      <h2 class="foot-h">Contact</h2>
      <ul class="plain">
        ${s.phone_number ? html`<li><a href="tel:${s.phone_number}">${formatPhone(s.phone_number)}</a></li>` : ''}
        ${s.whatsapp_number ? html`<li><a href="${waHref(s, `Hello ${s.business_name}, I would like to make an enquiry.`)}" target="_blank" rel="noopener noreferrer">WhatsApp ${formatPhone(s.whatsapp_number)}<span class="sr-only"> (opens in a new tab)</span></a></li>` : ''}
        ${s.email ? html`<li><a href="mailto:${s.email}">${s.email}</a></li>` : ''}
        ${s.address ? html`<li>${s.address}${s.area ? html`, ${s.area}` : ''}</li>` : s.area ? html`<li>${s.area}</li>` : ''}
        <li><a href="/contact">Send an enquiry</a></li>
      </ul>
      ${hours.length ? html`<h2 class="foot-h">Opening hours</h2><ul class="plain">${hours.map((h) => html`<li>${h}</li>`)}</ul>` : ''}
      ${[['Facebook', s.facebook_url], ['Instagram', s.instagram_url], ['TikTok', s.tiktok_url]].filter(([, u]) => u).length ? html`<ul class="plain social">${[['Facebook', s.facebook_url], ['Instagram', s.instagram_url], ['TikTok', s.tiktok_url]].filter(([, u]) => u).map(([n, u]) => html`<li><a href="${u}" target="_blank" rel="noopener noreferrer">${n}<span class="sr-only"> (opens in a new tab)</span></a></li>`)}</ul>` : ''}
    </div>
  </div>
  <div class="wrap legal"><p>© ${new Date().getFullYear()} ${s.business_name}. All rights reserved.</p></div>
</footer>`;
}

// ------------------------------------------------------------------ catalogue pieces
function priceBlock(item) {
  if (item.pricing_type === 'quote') return html`<span class="price"><strong>Contact us for pricing</strong></span>`;
  return html`<span class="price"><strong>${formatKES(item.price_minor)}</strong>${item.pricing_unit ? html` <span class="unit">${item.pricing_unit}</span>` : ''}</span>`;
}

function entry(item, s, { preview = false } = {}) {
  const msg = `Hello ${s.business_name}, I would like to enquire about ${item.name}. Could you please share more information?`;
  const wa = !preview && waHref(s, msg);
  return html`<li class="entry" id="item-${item.slug}">
  ${item.image_path ? html`<img class="entry-img" src="/uploads/${item.image_path}" alt="${item.image_alt}" width="96" height="96" loading="lazy">` : ''}
  <div class="entry-body">
    <div class="entry-head"><h3>${item.name}</h3><span class="leader" aria-hidden="true"></span>${priceBlock(item)}</div>
    ${item.availability === 'unavailable' ? html`<p><span class="badge">Currently unavailable</span></p>` : ''}
    ${item.description ? html`<p class="desc">${item.description}</p>` : ''}
    ${item.conditions ? html`<p class="cond">${item.conditions}</p>` : ''}
    ${preview ? '' : html`<p class="entry-actions">
      ${wa ? html`<a class="link-strong" href="${wa}" target="_blank" rel="noopener noreferrer">Ask on WhatsApp<span class="sr-only"> about ${item.name} (opens in a new tab)</span></a>` : ''}
      <a class="link-strong" href="/contact?service=${item.id}">Send an enquiry<span class="sr-only"> about ${item.name}</span></a>
    </p>`}
  </div>
</li>`;
}

function catalogueGroups(groups, s) {
  return groups.map((g) => html`<section class="cat" aria-labelledby="cat-${g.slug}">
    <h2 id="cat-${g.slug}">${g.name}</h2>
    <ul class="entries">${g.items.map((i) => entry(i, s))}</ul>
  </section>`);
}

function cataloguePage({ s, section, groups, q, intro, categories }) {
  const meta = SECTIONS[section];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return html`<section class="page-head"><div class="wrap">
    <h1>${meta.label}</h1>
    ${intro ? html`<p class="lead">${intro}</p>` : ''}
  </div></section>
  <div class="wrap catalogue">
    <form class="search" method="get" action="${meta.path}" role="search">
      <label for="q">Search ${meta.label.toLowerCase()}</label>
      <div class="search-row"><input id="q" name="q" type="search" value="${q}" maxlength="60" autocomplete="off"><button class="btn btn-dark" type="submit">Search</button>${q ? html`<a class="btn btn-ghost" href="${meta.path}">Clear</a>` : ''}</div>
    </form>
    ${categories.length > 1 && !q ? html`<nav class="chips" aria-label="Categories">${categories.map((c) => html`<a href="#cat-${c.slug}">${c.name}</a>`)}</nav>` : ''}
    ${total ? catalogueGroups(groups, s) : html`<div class="empty" role="status"><h2>${q ? 'No matching listings' : 'Our price list is being prepared'}</h2>
      <p>${q ? 'Try a different search term.' : 'Prices are published here as soon as they are confirmed. In the meantime, get in touch and we will gladly help.'}</p>
      <p class="actions">${waButton(s, 'Message us on WhatsApp', `Hello ${s.business_name}, I would like to ask about your ${meta.label.toLowerCase()}.`)} <a class="btn btn-dark" href="/contact">Send an enquiry</a></p></div>`}
    <aside class="quote-cta"><h2>Need something not listed?</h2><p>Ask us for a quotation or clarification.</p>
      <p class="actions">${waButton(s, 'WhatsApp us', `Hello ${s.business_name}, I would like a quotation.`)} ${telHref(s) ? html`<a class="btn btn-dark" href="${telHref(s)}">Call ${formatPhone(s.phone_number)}</a>` : ''} <a class="btn btn-ghost" href="/contact">Use the enquiry form</a></p></aside>
  </div>`;
}

// ------------------------------------------------------------------------- home
function homePage({ s, counts, cats, featured }) {
  const sections = ['laundry', 'cyber'];
  const featuredSecs = ['laundry', 'cyber', ...(s.food_enabled ? ['food'] : [])].filter((k) => featured[k]?.length);
  const hasHours = lines(s.opening_hours).length > 0;
  return html`
<section class="hero"><div class="wrap hero-grid">
  <div class="hero-copy">
    <h1>${s.hero_headline}</h1>
    <p class="lead">${s.hero_subtext || 'Laundry and cyber café services, with prices you can check before you visit.'}</p>
    <p class="actions">${waButton(s, 'Chat on WhatsApp', `Hello ${s.business_name}, I would like to make an enquiry.`)} <a class="btn btn-dark" href="/laundry">See laundry prices</a> <a class="btn btn-ghost" href="/cyber-cafe">Cyber café services</a></p>
  </div>
  <nav class="tag" aria-label="Our services">
    <span class="tag-hole" aria-hidden="true"></span>
    <p class="tag-name">${s.business_name}</p>
    <ul>
      <li><a href="/laundry">Laundry</a></li>
      <li><a href="/cyber-cafe">Cyber café</a></li>
      ${s.food_enabled ? html`<li><a href="/menu">Food menu</a></li>` : ''}
    </ul>
  </nav>
</div></section>

<section class="block"><div class="wrap">
  <h2>What we offer</h2>
  <div class="panels">
    ${sections.map((k) => html`<article class="panel"><h3><a href="${SECTIONS[k].path}">${SECTIONS[k].label}</a></h3>
      ${counts[k] ? html`<p>${counts[k]} ${counts[k] === 1 ? 'service' : 'services'} listed with prices.</p>
        <ul class="chips plain">${cats[k].map((c) => html`<li><a href="${SECTIONS[k].path}#cat-${c.slug}">${c.name}</a></li>`)}</ul>` : html`<p>The price list is being prepared.</p>`}
      <p><a class="link-strong" href="${SECTIONS[k].path}">View ${SECTIONS[k].label.toLowerCase()}<span class="sr-only"> services and prices</span></a></p></article>`)}
  </div>
</div></section>

${featuredSecs.length ? html`<section class="block board"><div class="wrap"><h2>Popular prices</h2>
  <div class="panels">${featuredSecs.map((k) => html`<div class="ticket"><h3>${SECTIONS[k].label}</h3>
    <ul class="entries compact">${featured[k].map((i) => html`<li class="entry"><div class="entry-head"><h4>${i.name}</h4><span class="leader" aria-hidden="true"></span>${priceBlock(i)}</div></li>`)}</ul>
    <p><a class="link-strong" href="${SECTIONS[k].path}">Full ${SECTIONS[k].label.toLowerCase()} list<span class="sr-only"> and conditions</span></a></p></div>`)}</div></div></section>` : ''}

${lines(s.value_points).length ? html`<section class="block"><div class="wrap"><h2>Why customers choose us</h2><ul class="points">${lines(s.value_points).map((p) => html`<li>${p}</li>`)}</ul></div></section>` : ''}

<section class="block"><div class="wrap"><h2>How it works</h2>
  <ol class="steps">
    <li><h3>Check the prices</h3><p>Browse the laundry and cyber café lists.</p></li>
    <li><h3>Get in touch</h3><p>Message us on WhatsApp, call, or send the enquiry form.</p></li>
    <li><h3>Follow up</h3><p>We reply using the contact method you choose.</p></li>
  </ol>
</div></section>

${hasLocation(s) || hasHours || s.map_url ? html`<section class="block"><div class="wrap"><h2>Find us</h2><div class="panels">
  ${hasLocation(s) ? html`<div><h3>Location</h3><p>${s.address}${s.area ? html`${s.address ? ', ' : ''}${s.area}` : ''}</p>${s.map_url ? html`<p><a class="link-strong" href="${s.map_url}" target="_blank" rel="noopener noreferrer">Get directions<span class="sr-only"> (opens in a new tab)</span></a></p>` : ''}</div>` : ''}
  ${hasHours ? html`<div><h3>Opening hours</h3><ul class="plain">${lines(s.opening_hours).map((h) => html`<li>${h}</li>`)}</ul></div>` : ''}
</div></div></section>` : ''}

<section class="cta-band"><div class="wrap"><h2>Questions? Talk to us.</h2>
  <p class="actions">${waButton(s, 'WhatsApp us', `Hello ${s.business_name}, I would like to make an enquiry.`)} ${telHref(s) ? html`<a class="btn btn-light" href="${telHref(s)}">Call ${formatPhone(s.phone_number)}</a>` : ''} <a class="btn btn-light" href="/contact">Send an enquiry</a></p></div></section>`;
}

function aboutPage({ s }) {
  const cats = ['laundry services', 'cyber café services', ...(s.food_enabled ? ['food and refreshments'] : [])];
  const list = cats.length > 2 ? `${cats.slice(0, -1).join(', ')} and ${cats.at(-1)}` : cats.join(' and ');
  const paras = paragraphs(s.about_text);
  return html`<section class="page-head"><div class="wrap"><h1>About ${s.business_name}</h1></div></section>
  <div class="wrap prose">
    ${paras.length ? paras.map((p) => html`<p>${p}</p>`) : html`<p>${s.business_name} offers ${list}.</p>`}
    ${s.mission ? html`<h2>Our mission</h2><p>${s.mission}</p>` : ''}
    ${s.vision ? html`<h2>Our vision</h2><p>${s.vision}</p>` : ''}
    <h2>What we do</h2>
    <ul><li><a href="/laundry">Laundry services</a></li><li><a href="/cyber-cafe">Cyber café services</a></li>${s.food_enabled ? html`<li><a href="/menu">Food menu</a></li>` : ''}</ul>
    <p class="actions">${waButton(s, 'Chat on WhatsApp', `Hello ${s.business_name}, I would like to make an enquiry.`)} <a class="btn btn-dark" href="/contact">Send an enquiry</a></p>
  </div>`;
}

// ---------------------------------------------------------------------- contact
function field(id, label, control, error, hint) {
  return html`<div class="field ${error ? 'has-error' : ''}"><label for="${id}">${label}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}${control}${error ? html`<p class="error" id="${id}-err" role="alert">${error}</p>` : ''}</div>`;
}
function contactPage({ s, values = {}, errors = {}, token, notice }) {
  const describe = (id, hint) => [hint ? `${id}-hint` : '', errors[id] ? `${id}-err` : ''].filter(Boolean).join(' ');
  const cats = Object.entries(CATEGORIES).filter(([k]) => k !== 'food' || s.food_enabled);
  const hours = lines(s.opening_hours);
  return html`<section class="page-head"><div class="wrap"><h1>Contact ${s.business_name}</h1><p class="lead">Ask about a service, a price or a quotation.</p></div></section>
  <div class="wrap contact-grid">
    <section aria-labelledby="form-h">
      <h2 id="form-h">Send an enquiry</h2>
      ${notice ? html`<p class="alert alert-error" role="alert">${notice}</p>` : ''}
      ${Object.keys(errors).length && !notice ? html`<p class="alert alert-error" role="alert">Please fix the highlighted fields.</p>` : ''}
      <form method="post" action="/contact" novalidate data-busy="Sending…" class="stack">
        <input type="hidden" name="_t" value="${token}">
        <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
        ${field('name', 'Your name', html`<input id="name" name="name" required maxlength="100" autocomplete="name" value="${values.name}" aria-invalid="${errors.name ? 'true' : 'false'}" aria-describedby="${describe('name')}">`, errors.name)}
        ${field('contact_method', 'How should we reach you?', html`<select id="contact_method" name="contact_method" required aria-invalid="${errors.contact_method ? 'true' : 'false'}" aria-describedby="${describe('contact_method')}"><option value="">Choose…</option>${Object.entries(METHODS).map(([k, l]) => html`<option value="${k}" ${values.contact_method === k ? raw('selected') : ''}>${l}</option>`)}</select>`, errors.contact_method)}
        ${field('contact_value', 'Phone number or e-mail', html`<input id="contact_value" name="contact_value" required maxlength="120" autocomplete="off" value="${values.contact_value}" aria-invalid="${errors.contact_value ? 'true' : 'false'}" aria-describedby="${describe('contact_value', 'We use this only to reply to you.')}">`, errors.contact_value, 'We use this only to reply to you.')}
        ${field('category', 'What is your enquiry about?', html`<select id="category" name="category" required aria-invalid="${errors.category ? 'true' : 'false'}" aria-describedby="${describe('category')}"><option value="">Choose…</option>${cats.map(([k, l]) => html`<option value="${k}" ${values.category === k ? raw('selected') : ''}>${l}</option>`)}</select>`, errors.category)}
        ${field('message', 'Your message', html`<textarea id="message" name="message" rows="6" required minlength="10" maxlength="1000" aria-invalid="${errors.message ? 'true' : 'false'}" aria-describedby="${describe('message')}">${values.message}</textarea>`, errors.message)}
        <p class="hint">By sending this form you agree that we may use your details to reply. See the <a href="/privacy">privacy notice</a>.</p>
        <button class="btn btn-primary" type="submit">Send enquiry</button>
      </form>
    </section>
    <aside aria-labelledby="direct-h" class="direct">
      <h2 id="direct-h">Reach us directly</h2>
      <ul class="plain contact-list">
        ${s.whatsapp_number ? html`<li>${waButton(s, `WhatsApp ${formatPhone(s.whatsapp_number)}`, `Hello ${s.business_name}, I would like to make an enquiry.`)}</li>` : ''}
        ${s.phone_number ? html`<li><a class="btn btn-dark" href="tel:${s.phone_number}">Call ${formatPhone(s.phone_number)}</a></li>` : ''}
        ${s.email ? html`<li><a href="mailto:${s.email}">${s.email}</a></li>` : ''}
      </ul>
      ${hasLocation(s) ? html`<h3>Location</h3><p>${s.address}${s.area ? html`${s.address ? ', ' : ''}${s.area}` : ''}</p>${s.map_url ? html`<p><a class="link-strong" href="${s.map_url}" target="_blank" rel="noopener noreferrer">Get directions<span class="sr-only"> (opens in a new tab)</span></a></p>` : ''}` : ''}
      ${hours.length ? html`<h3>Opening hours</h3><ul class="plain">${hours.map((h) => html`<li>${h}</li>`)}</ul>` : ''}
      ${!s.whatsapp_number && !s.phone_number && !s.email && !hasLocation(s) ? html`<p>The enquiry form is the best way to reach us for now.</p>` : ''}
    </aside>
  </div>`;
}

function thanksPage({ s, ref }) {
  return html`<section class="page-head"><div class="wrap"><h1>Thank you</h1></div></section>
  <div class="wrap prose"><p role="status">We have received your enquiry${ref ? html`. Your reference is <strong>${ref}</strong>` : ''}. We will get back to you using the contact details you gave.</p>
  <p class="actions"><a class="btn btn-dark" href="/">Back to home</a> <a class="btn btn-ghost" href="/laundry">Laundry prices</a></p></div>`;
}

function privacyPage({ s }) {
  const contactBits = [s.email && `by e-mail at ${s.email}`, s.phone_number && `by phone on ${formatPhone(s.phone_number)}`].filter(Boolean);
  return html`<section class="page-head"><div class="wrap"><h1>Privacy notice</h1></div></section>
  <div class="wrap prose">
    ${s.privacy_reviewed ? '' : html`<p class="alert alert-warn" role="note">This notice is awaiting owner review. It describes what this website actually does, but it has not yet been confirmed by the business owner or a legal adviser.</p>`}
    <h2>Who we are</h2><p>${s.business_name} operates this website. You can contact us ${contactBits.length ? contactBits.join(' or ') + ' or ' : ''}through the <a href="/contact">contact form</a>.</p>
    <h2>What we collect</h2>
    <p>If you use the contact form we collect your name, how you want to be reached, your phone number or e-mail, the subject of your enquiry and your message. We do not ask for anything else.</p>
    <p>This website does not use advertising or analytics cookies or trackers. A sign-in cookie is set only for staff who log in to the administration area. Our web host may process technical connection data, such as IP addresses, in its standard server logs.</p>
    <h2>Why we collect it</h2><p>To read and reply to your enquiry. We do not sell your information and do not use it for marketing unless you ask us to.</p>
    <h2>Who can see it</h2><p>Authorised ${s.business_name} staff who manage enquiries. Our hosting provider stores the data on our behalf. If you choose to contact us through WhatsApp, your message is handled by WhatsApp under its own privacy terms.</p>
    <h2>How long we keep it</h2><p>${s.retention_months ? `We keep enquiries for up to ${s.retention_months} months, then delete them.` : 'We keep enquiries only for as long as needed to respond and manage the customer relationship, then delete them.'}</p>
    <h2>Your rights</h2><p>You may ask to see, correct or delete the information we hold about you, or object to how we use it, by contacting us using the details above. Kenya's Data Protection Act, 2019 gives individuals rights over their personal data, and you may also complain to the Office of the Data Protection Commissioner.</p>
  </div>`;
}

function errorPage({ s, code, title, message }) {
  return html`<section class="page-head"><div class="wrap"><p class="code">${code}</p><h1>${title}</h1></div></section><div class="wrap prose"><p>${message}</p><p class="actions"><a class="btn btn-dark" href="/">Back to home</a> <a class="btn btn-ghost" href="/contact">Contact us</a></p></div>`;
}

module.exports = { layout, homePage, aboutPage, cataloguePage, contactPage, thanksPage, privacyPage, errorPage, entry, waButton };
