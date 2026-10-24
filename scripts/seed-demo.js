'use strict';
// DEVELOPMENT ONLY. Adds clearly-labelled synthetic listings so you can see the site working.
// These are NOT real M-Interest services or prices. Refuses to run in production.
require('./load-env');
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const catalog = require('../src/models/catalog');

const cfg = loadConfig();
if (cfg.isProd) { console.error('Refusing to add demo data in production.'); process.exit(1); }

const settings = { allow_contact_for_pricing: false };
const data = {
  laundry: { 'DEMO Washing': [['DEMO Wash and fold', 150, 'per kg'], ['DEMO Duvet wash', 800, 'per item']] },
  cyber: { 'DEMO Printing': [['DEMO Black and white print', 10, 'per page'], ['DEMO Colour print', 30, 'per page']] },
};
(async () => {
const db = await openDb(cfg.databaseUrl, { ssl: cfg.databaseSsl });
for (const [section, cats] of Object.entries(data)) {
  for (const [catName, items] of Object.entries(cats)) {
    const cid = await catalog.createCategory(db, section, catalog.validateCategory({ name: catName, is_published: 'on' }).values);
    for (const [name, price, unit] of items) {
      const { values, errors } = catalog.validateItem({ name, category_id: String(cid), price: String(price), pricing_unit: unit, status: 'published', featured: 'on' }, { section, categories: await catalog.listCategories(db, section), settings });
      if (Object.keys(errors).length) throw new Error(JSON.stringify(errors));
      await catalog.createItem(db, section, values, null);
    }
  }
}
console.log('Demo listings added. Remove them from the dashboard before launch.');
await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
