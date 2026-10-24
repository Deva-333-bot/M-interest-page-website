'use strict';
const { html, raw, esc, fmtDate, formatKES, minorToInput, SECTIONS } = require('../util');
const { SCHEMA } = require('../models/settings');
const { STATUSES, CATEGORIES, METHODS } = require('../models/enquiries');
const { UNIT_SUGGESTIONS } = require('../models/catalog');

function layout({ title, user, s, csrf, flash = [], body, active, newEnquiries = 0 }) {
  const nav = [['/admin', 'Dashboard', 'dash'], ['/admin/items/laundry', 'Laundry', 'laundry'], ['/admin/items/cyber', 'Cyber café', 'cyber']];
  if (s?.food_enabled) nav.push(['/admin/items/food', 'Food menu', 'food']);
  nav.push(['/admin/enquiries', 'Enquiries', 'enq']);
  if (user?.role === 'owner') nav.push(['/admin/settings', 'Settings', 'settings']);
  nav.push(['/admin/account', 'Account', 'account']);
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} | Admin</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/admin.css?v=1"><script src="/js/site.js" defer></script></head>
<body><a class="skip" href="#main">Skip to main content</a>
${user ? html`<div class="shell">
  <aside class="side"><p class="side-brand">${s?.business_name || 'M-Interest'} <span>Admin</span></p>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="admin-nav">Menu</button>
    <nav id="admin-nav" aria-label="Admin"><ul>${nav.map(([h, l, k]) => html`<li><a href="${h}" ${active === k ? raw('aria-current="page"') : ''}>${l}${k === 'enq' && newEnquiries ? html` <span class="count" aria-label="${newEnquiries} new">${newEnquiries}</span>` : ''}</a></li>`)}</ul>
    <p class="side-foot"><a href="/" target="_blank" rel="noopener noreferrer">View public site<span class="sr-only"> (opens in a new tab)</span></a></p>
    <form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
    <p class="who">${user.email}<br>${user.role === 'owner' ? 'Owner' : 'Staff'}</p></nav></aside>
  <main id="main" tabindex="-1" class="content"><h1>${title}</h1>${flashes(flash)}${body}</main></div>`
  : html`<main id="main" tabindex="-1" class="solo"><h1>${title}</h1>${flashes(flash)}${body}</main>`}
</body></html>`;
}
const flashes = (list) => list.map((f) => html`<p class="alert alert-${f.type}" role="${f.type === 'error' ? 'alert' : 'status'}">${f.text}</p>`);
const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

function textField({ id, label, value = '', errors = {}, type = 'text', hint, attrs = '', required = false, max }) {
  const err = errors[id];
  return html`<div class="field ${err ? 'has-error' : ''}"><label for="${id}">${label}${required ? html` <span class="req">(required)</span>` : ''}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    <input id="${id}" name="${id}" type="${type}" value="${value}" ${max ? raw(`maxlength="${max}"`) : ''} ${required ? raw('required') : ''} ${raw(attrs)} aria-invalid="${err ? 'true' : 'false'}" ${hint || err ? raw(`aria-describedby="${esc([hint ? id + '-hint' : '', err ? id + '-err' : ''].filter(Boolean).join(' '))}"`) : ''}>
    ${err ? html`<p class="error" id="${id}-err">${err}</p>` : ''}</div>`;
}
function areaField({ id, label, value = '', errors = {}, rows = 4, hint, max }) {
  const err = errors[id];
  return html`<div class="field ${err ? 'has-error' : ''}"><label for="${id}">${label}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    <textarea id="${id}" name="${id}" rows="${rows}" ${max ? raw(`maxlength="${max}"`) : ''} aria-invalid="${err ? 'true' : 'false'}">${value}</textarea>${err ? html`<p class="error">${err}</p>` : ''}</div>`;
}
function selectField({ id, label, options, value, errors = {}, hint }) {
  const err = errors[id];
  return html`<div class="field ${err ? 'has-error' : ''}"><label for="${id}">${label}</label>${hint ? html`<p class="hint">${hint}</p>` : ''}
    <select id="${id}" name="${id}" aria-invalid="${err ? 'true' : 'false'}">${options.map(([v, l]) => html`<option value="${v}" ${String(value) === String(v) ? raw('selected') : ''}>${l}</option>`)}</select>${err ? html`<p class="error">${err}</p>` : ''}</div>`;
}
const checkField = ({ id, label, checked, hint }) => html`<div class="field check"><label><input type="checkbox" name="${id}" value="1" ${checked ? raw('checked') : ''}> ${label}</label>${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;

// ---------------------------------------------------------------------- auth
function loginPage({ error, token }) {
  return html`${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/admin/login" class="stack card" data-busy="Signing in…" autocomplete="on">
    <input type="hidden" name="_t" value="${token}">
    ${textField({ id: 'email', label: 'E-mail', type: 'email', attrs: 'autocomplete="username" autofocus', required: true, max: 254 })}
    ${textField({ id: 'password', label: 'Password', type: 'password', attrs: 'autocomplete="current-password"', required: true, max: 200 })}
    <button class="btn btn-primary" type="submit">Sign in</button>
  </form>`;
}
function setupPage({ errors = {}, values = {}, error, token }) {
  return html`<p>Create the first owner account. This page disappears as soon as an administrator exists.</p>${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/admin/setup" class="stack card" data-busy="Creating…" autocomplete="off">
    <input type="hidden" name="_t" value="${token}">
    ${textField({ id: 'setup_token', label: 'Setup token', type: 'password', required: true, hint: 'The SETUP_TOKEN value from the server environment.', errors })}
    ${textField({ id: 'email', label: 'Owner e-mail', type: 'email', value: values.email, required: true, errors, max: 254 })}
    ${textField({ id: 'password', label: 'Password', type: 'password', required: true, hint: 'At least 12 characters.', errors, attrs: 'autocomplete="new-password"' })}
    ${textField({ id: 'password2', label: 'Repeat password', type: 'password', required: true, errors, attrs: 'autocomplete="new-password"' })}
    <button class="btn btn-primary" type="submit">Create owner account</button></form>`;
}

// ---------------------------------------------------------------- dashboard
function dashboardPage({ stats, recentItems, warnings, activity, enquiries }) {
  return html`<section><h2>Overview</h2><div class="stats">
    ${stats.map((x) => html`<a class="stat" href="${x.href}"><strong>${x.published}</strong><span>${x.label} published</span><small>${x.drafts} draft${x.drafts === 1 ? '' : 's'}${x.unavailable ? `, ${x.unavailable} unavailable` : ''}</small></a>`)}
    <a class="stat" href="/admin/enquiries?status=new"><strong>${enquiries.newCount}</strong><span>New enquiries</span><small>${enquiries.total} stored in total</small></a></div></section>
  <section><h2>Needs attention</h2>${warnings.length ? html`<ul class="warn-list">${warnings.map((w) => html`<li>${w.href ? html`<a href="${w.href}">${w.text}</a>` : html`${w.text} <em>(ask the owner)</em>`}</li>`)}</ul>` : html`<p>Nothing needs attention.</p>`}</section>
  <section><h2>Recently updated listings</h2>${recentItems.length ? html`<table class="table"><thead><tr><th>Listing</th><th>Section</th><th>Status</th><th>Updated</th></tr></thead><tbody>
    ${recentItems.map((i) => html`<tr><td><a href="/admin/items/${i.section}/${i.id}/edit">${i.name}</a></td><td>${SECTIONS[i.section].label}</td><td>${statusBadge(i)}</td><td>${fmtDate(i.updated_at)}</td></tr>`)}</tbody></table>` : html`<p>No listings yet. Start by adding a category, then a listing.</p>`}</section>
  <section><h2>Recent activity</h2>${activity.length ? html`<ul class="plain activity">${activity.map((a) => html`<li><span>${fmtDate(a.created_at)}</span> ${a.actor_email || 'System'}: ${a.action} ${a.entity_type}${a.detail ? html` <em>${a.detail}</em>` : ''}</li>`)}</ul>` : html`<p>No activity yet.</p>`}</section>`;
}
function statusBadge(i) {
  if (i.status === 'draft') return html`<span class="badge badge-draft">Draft</span>`;
  const hidden = !i.category_published;
  return html`<span class="badge badge-live">Published</span>${i.availability === 'unavailable' ? html` <span class="badge">Unavailable</span>` : ''}${hidden ? html` <span class="badge badge-warn" title="The category is unpublished">Hidden by category</span>` : ''}`;
}

// --------------------------------------------------------------- items list
function pager(base, page, pages) {
  if (pages <= 1) return '';
  const link = (p, l) => html`<a class="btn btn-ghost btn-sm" href="${base}${base.includes('?') ? '&' : '?'}page=${p}">${l}</a>`;
  return html`<nav class="pager" aria-label="Pages">${page > 1 ? link(page - 1, 'Previous') : ''}<span>Page ${page} of ${pages}</span>${page < pages ? link(page + 1, 'Next') : ''}</nav>`;
}
function itemsPage({ section, data, categories, filters, csrf }) {
  const meta = SECTIONS[section];
  const base = `/admin/items/${section}?${new URLSearchParams({ q: filters.q, category: filters.category || '', status: filters.status }).toString()}`;
  return html`<p class="toolbar"><a class="btn btn-primary" href="/admin/items/${section}/new">Add ${meta.singular}</a> <a class="btn btn-ghost" href="/admin/categories/${section}">Manage categories</a> <a class="btn btn-ghost" href="${meta.path}" target="_blank" rel="noopener noreferrer">View public page<span class="sr-only"> (opens in a new tab)</span></a></p>
  <form class="filters" method="get" action="/admin/items/${section}" role="search">
    <div class="field"><label for="q">Search</label><input id="q" name="q" value="${filters.q}" maxlength="60"></div>
    ${selectField({ id: 'category', label: 'Category', value: filters.category || '', options: [['', 'All categories'], ...categories.map((c) => [c.id, c.name])] })}
    ${selectField({ id: 'status', label: 'Status', value: filters.status, options: [['', 'All'], ['published', 'Published'], ['draft', 'Draft'], ['unavailable', 'Unavailable']] })}
    <button class="btn btn-dark" type="submit">Filter</button></form>
  ${data.rows.length ? html`<table class="table"><thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${data.rows.map((i) => html`<tr><td><a href="/admin/items/${section}/${i.id}/edit">${i.name}</a></td><td>${i.category_name}</td>
      <td>${i.pricing_type === 'quote' ? 'Contact us' : i.price_minor === null ? html`<em>none</em>` : html`${formatKES(i.price_minor)} ${i.pricing_unit}`}</td><td>${statusBadge(i)}</td>
      <td class="row-actions"><a href="/admin/items/${section}/${i.id}/edit">Edit</a> <a href="/admin/items/${section}/${i.id}/preview">Preview</a>
        <form method="post" action="/admin/items/${section}/${i.id}/status" data-busy="Saving…">${csrfField(csrf)}<input type="hidden" name="status" value="${i.status === 'published' ? 'draft' : 'published'}"><button class="linkbtn" type="submit">${i.status === 'published' ? 'Unpublish' : 'Publish'}</button></form>
        <a class="danger" href="/admin/items/${section}/${i.id}/delete">Delete</a></td></tr>`)}</tbody></table>${pager(base, data.page, data.pages)}`
    : html`<p class="empty">${filters.q || filters.category || filters.status ? 'No listings match these filters.' : `No ${meta.singular}s yet.`}${categories.length ? '' : html` Create a category first under <a href="/admin/categories/${section}">Manage categories</a>.`}</p>`}`;
}

// ------------------------------------------------------------------ item form
function itemForm({ section, item = {}, values, errors = {}, categories, csrf, isNew, settings }) {
  const v = values || { name: item.name, category_id: item.category_id, description: item.description, pricing_type: item.pricing_type || 'fixed', price: minorToInput(item.price_minor), pricing_unit: item.pricing_unit, conditions: item.conditions, image_alt: item.image_alt, availability: item.availability || 'available', status: item.status || 'draft', sort_order: item.sort_order ?? 0, featured: item.featured };
  const action = isNew ? `/admin/items/${section}` : `/admin/items/${section}/${item.id}`;
  return html`${Object.keys(errors).length ? html`<p class="alert alert-error" role="alert">Please fix the highlighted fields.</p>` : ''}
  <form method="post" action="${action}" enctype="multipart/form-data" class="stack card" data-busy="Saving…" novalidate>
    ${csrfField(csrf)}
    ${textField({ id: 'name', label: 'Name', value: v.name || '', errors, required: true, max: 120 })}
    ${selectField({ id: 'category_id', label: 'Category', value: v.category_id || '', errors, options: [['', 'Choose…'], ...categories.map((c) => [c.id, c.name + (c.is_published ? '' : ' (unpublished)')])], hint: categories.length ? '' : 'No categories yet. Create one first.' })}
    ${areaField({ id: 'description', label: 'Description', value: v.description || '', errors, rows: 3, max: 600 })}
    <fieldset><legend>Pricing</legend>
      ${selectField({ id: 'pricing_type', label: 'Pricing type', value: v.pricing_type, errors, options: [['fixed', 'Fixed price'], ['quote', 'Contact us for pricing']], hint: settings.allow_contact_for_pricing ? '' : '"Contact us" listings can be saved as drafts, but publishing them requires owner approval in Settings.' })}
      ${textField({ id: 'price', label: 'Price (KES)', value: v.price || '', errors, attrs: 'inputmode="decimal" placeholder="e.g. 250 or 250.50"', hint: 'Numbers only. Leave empty for "Contact us" listings.' })}
      ${textField({ id: 'pricing_unit', label: 'Pricing unit', value: v.pricing_unit || '', errors, attrs: 'list="unit-list"', hint: 'What the price covers, e.g. per kg, per page, per hour.', max: 40 })}
      <datalist id="unit-list">${UNIT_SUGGESTIONS[section].map((u) => html`<option value="${u}"></option>`)}</datalist>
      ${areaField({ id: 'conditions', label: 'Conditions or exclusions (optional)', value: v.conditions || '', errors, rows: 2, max: 300 })}
    </fieldset>
    <fieldset><legend>Image (optional)</legend>
      ${item.image_path ? html`<p><img class="thumb" src="/uploads/${item.image_path}" alt="${item.image_alt}" width="96" height="96"></p>${checkField({ id: 'remove_image', label: 'Remove current image' })}` : ''}
      <div class="field ${errors.image ? 'has-error' : ''}"><label for="image">${item.image_path ? 'Replace image' : 'Upload image'}</label><p class="hint">JPG, PNG or WebP, up to 1 MB. Use only photos the business owns or has permission to use.</p><input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp">${errors.image ? html`<p class="error">${errors.image}</p>` : ''}</div>
      ${textField({ id: 'image_alt', label: 'Image description (for screen readers)', value: v.image_alt || '', errors, max: 150 })}
    </fieldset>
    <fieldset><legend>Visibility</legend>
      ${selectField({ id: 'availability', label: 'Availability', value: v.availability, options: [['available', 'Available'], ['unavailable', 'Currently unavailable']] })}
      ${selectField({ id: 'status', label: 'Publication status', value: v.status, options: [['draft', 'Draft (not visible to the public)'], ['published', 'Published (visible on the website)']] })}
      ${checkField({ id: 'featured', label: 'Show in "Popular prices" on the homepage', checked: Boolean(Number(v.featured)) || v.featured === '1' || v.featured === 'on' })}
      ${textField({ id: 'sort_order', label: 'Sort order', value: String(v.sort_order ?? 0), errors, attrs: 'inputmode="numeric"', hint: 'Lower numbers appear first within a category.' })}
    </fieldset>
    <p class="actions"><button class="btn btn-primary" type="submit">${isNew ? 'Create listing' : 'Save changes'}</button> <a class="btn btn-ghost" href="/admin/items/${section}">Cancel</a></p>
  </form>`;
}

function confirmPage({ question, detail, action, csrf, back, label = 'Delete permanently' }) {
  return html`<div class="card stack"><p><strong>${question}</strong></p>${detail ? html`<p>${detail}</p>` : ''}<p>This cannot be undone.</p>
    <form method="post" action="${action}" data-busy="Deleting…">${csrfField(csrf)}<p class="actions"><button class="btn btn-danger" type="submit">${label}</button> <a class="btn btn-ghost" href="${back}">Cancel</a></p></form></div>`;
}

// ---------------------------------------------------------------- categories
function categoriesPage({ section, categories, csrf, values = {}, errors = {} }) {
  const meta = SECTIONS[section];
  return html`<p><a href="/admin/items/${section}">← Back to ${meta.label.toLowerCase()} listings</a></p>
  <table class="table"><thead><tr><th>Name</th><th>Listings</th><th>Visible</th><th>Order</th><th>Actions</th></tr></thead><tbody>
  ${categories.length ? categories.map((c) => html`<tr><td>${c.name}</td><td>${c.item_count}</td><td>${c.is_published ? 'Yes' : 'No'}</td><td>${c.sort_order}</td><td class="row-actions"><a href="/admin/categories/${section}/${c.id}/edit">Edit</a> <a class="danger" href="/admin/categories/${section}/${c.id}/delete">Delete</a></td></tr>`) : html`<tr><td colspan="5">No categories yet.</td></tr>`}</tbody></table>
  <h2>Add a category</h2>${categoryForm({ action: `/admin/categories/${section}`, csrf, values: { is_published: 1, sort_order: 0, ...values }, errors, label: 'Add category' })}`;
}
function categoryForm({ action, csrf, values, errors, label, cancel }) {
  return html`<form method="post" action="${action}" class="stack card" data-busy="Saving…" novalidate>${csrfField(csrf)}
    ${textField({ id: 'name', label: 'Name', value: values.name || '', errors, required: true, max: 80 })}
    ${areaField({ id: 'description', label: 'Description (optional)', value: values.description || '', errors, rows: 2, max: 300 })}
    ${textField({ id: 'sort_order', label: 'Sort order', value: String(values.sort_order ?? 0), errors, attrs: 'inputmode="numeric"' })}
    ${checkField({ id: 'is_published', label: 'Visible on the website', checked: Boolean(Number(values.is_published)) || values.is_published === 'on', hint: 'Listings in a hidden category are not shown publicly.' })}
    <p class="actions"><button class="btn btn-primary" type="submit">${label}</button>${cancel ? html` <a class="btn btn-ghost" href="${cancel}">Cancel</a>` : ''}</p></form>`;
}

// ----------------------------------------------------------------- enquiries
function enquiriesPage({ data, filters }) {
  const base = `/admin/enquiries?${new URLSearchParams({ status: filters.status, q: filters.q }).toString()}`;
  return html`<form class="filters" method="get" action="/admin/enquiries" role="search">
    <div class="field"><label for="q">Search</label><input id="q" name="q" value="${filters.q}" maxlength="60"></div>
    ${selectField({ id: 'status', label: 'Status', value: filters.status, options: [['', 'Open (excluding archived)'], ...Object.entries(STATUSES)] })}
    <button class="btn btn-dark" type="submit">Filter</button></form>
  ${data.rows.length ? html`<table class="table"><thead><tr><th>Reference</th><th>From</th><th>About</th><th>Status</th><th>Received</th></tr></thead><tbody>
    ${data.rows.map((e) => html`<tr><td><a href="/admin/enquiries/${e.id}">${e.ref}</a></td><td>${e.name}</td><td>${CATEGORIES[e.category]}</td><td><span class="badge badge-${e.status}">${STATUSES[e.status]}</span></td><td>${fmtDate(e.created_at)}</td></tr>`)}</tbody></table>${pager(base, data.page, data.pages)}` : html`<p class="empty">No enquiries to show.</p>`}`;
}
function enquiryPage({ e, csrf }) {
  return html`<p><a href="/admin/enquiries">← All enquiries</a></p><div class="card stack"><dl class="facts">
    <dt>Reference</dt><dd>${e.ref}</dd><dt>Received</dt><dd>${fmtDate(e.created_at)}</dd><dt>Name</dt><dd>${e.name}</dd>
    <dt>Preferred contact</dt><dd>${METHODS[e.contact_method]}: ${e.contact_method === 'email' ? html`<a href="mailto:${e.contact_value}">${e.contact_value}</a>` : html`<a href="tel:${e.contact_value}">${e.contact_value}</a>`}</dd>
    <dt>About</dt><dd>${CATEGORIES[e.category]}</dd></dl>
    <h2>Message</h2><p class="message">${e.message}</p></div>
  <form method="post" action="/admin/enquiries/${e.id}" class="stack card" data-busy="Saving…">${csrfField(csrf)}
    ${selectField({ id: 'status', label: 'Status', value: e.status, options: Object.entries(STATUSES) })}
    ${areaField({ id: 'notes', label: 'Internal notes (never shown to the customer)', value: e.internal_notes, rows: 4, max: 1000 })}
    <p class="actions"><button class="btn btn-primary" type="submit">Save</button> <a class="btn btn-danger-outline" href="/admin/enquiries/${e.id}/delete">Delete…</a></p></form>`;
}

// ------------------------------------------------------------------ settings
function settingsPage({ values, errors = {}, csrf, settings }) {
  const groups = { business: 'Business details', home: 'Homepage and About content', options: 'Site options' };
  const control = ([key, def]) => {
    const val = values[key] ?? '';
    if (def.type === 'bool') return checkField({ id: key, label: def.label, checked: val === true || val === '1', hint: def.help });
    if (def.type === 'textarea') return areaField({ id: key, label: def.label, value: val, errors, rows: def.max > 500 ? 6 : 3, hint: def.help, max: def.max });
    if (def.type === 'select') return selectField({ id: key, label: def.label, value: val, errors, options: Object.entries(def.options) });
    return textField({ id: key, label: def.label, value: val, errors, hint: def.help, required: def.required, max: def.max || 200, type: def.type === 'email' ? 'email' : 'text' });
  };
  return html`${Object.keys(errors).length ? html`<p class="alert alert-error" role="alert">Please fix the highlighted fields.</p>` : ''}
  <form method="post" action="/admin/settings" enctype="multipart/form-data" class="stack" data-busy="Saving…" novalidate>${csrfField(csrf)}
    ${Object.entries(groups).map(([g, title]) => html`<fieldset class="card"><legend>${title}</legend>${Object.entries(SCHEMA).filter(([, d]) => d.group === g).map(control)}
      ${g === 'business' ? html`<div class="field ${errors.logo ? 'has-error' : ''}"><label for="logo">Logo (optional)</label><p class="hint">JPG, PNG or WebP. If none is uploaded the site shows a plain text name.</p>
        ${settings.logo_path ? html`<p><img class="thumb" src="/uploads/${settings.logo_path}" alt="Current logo" height="48"></p>${checkField({ id: 'remove_logo', label: 'Remove current logo' })}` : ''}<input id="logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp">${errors.logo ? html`<p class="error">${errors.logo}</p>` : ''}</div>` : ''}</fieldset>`)}
    <p class="actions"><button class="btn btn-primary" type="submit">Save settings</button></p></form>`;
}

function accountPage({ csrf, errors = {} }) {
  return html`<form method="post" action="/admin/account" class="stack card" data-busy="Saving…" autocomplete="off"><h2>Change password</h2>${csrfField(csrf)}
    ${textField({ id: 'current', label: 'Current password', type: 'password', errors, required: true, attrs: 'autocomplete="current-password"' })}
    ${textField({ id: 'password', label: 'New password', type: 'password', errors, required: true, hint: 'At least 12 characters.', attrs: 'autocomplete="new-password"' })}
    ${textField({ id: 'password2', label: 'Repeat new password', type: 'password', errors, required: true, attrs: 'autocomplete="new-password"' })}
    <button class="btn btn-primary" type="submit">Change password</button></form>`;
}

module.exports = { layout, loginPage, setupPage, dashboardPage, itemsPage, itemForm, confirmPage, categoriesPage, categoryForm, enquiriesPage, enquiryPage, settingsPage, accountPage };
