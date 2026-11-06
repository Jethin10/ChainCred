const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMemoryStore } = require('../src/store/memory');
const { createMerchantService } = require('../src/services/merchants');
const { createApi } = require('../src/api');

test('registered merchants appear publicly, with safe fields and current profiles', async (t) => {
  const store = createMemoryStore(['merchants']);
  const merchants = createMerchantService(store, {}, {});
  const app = createApi({ store, merchants });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/v1/public/merchants`;
  const read = async (suffix = '') => {
    const res = await fetch(url + suffix);
    assert.equal(res.status, 200, 'the public shop directory must exist');
    return res.json();
  };
  await store.insert('merchants', { id: 'shop-1', name: 'New Shop', apiKeyHash: 'private', signerKeyEnc: 'private', webhookSecret: 'private', webhookUrl: 'https://private.example', profile: { website: 'https://shop.example', category: 'Books', tagline: 'Independent books', accent: '#123456' } });
  let result = await read();
  assert.deepEqual(result.data.map((m) => m.id), ['shop-1']);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['createdAt', 'id', 'name', 'profile']);
  assert.equal(JSON.stringify(result).includes('private'), false);
  await store.insert('merchants', { id: 'shop-2', name: 'Another Shop' });
  await merchants.update(await store.get('merchants', 'shop-1'), { profile: { tagline: 'Updated profile', website: 'https://new.example' } });
  result = await read();
  assert.equal(result.data.length, 2, 'new registrations need no manual listing or reward');
  assert.equal(result.data.find((m) => m.id === 'shop-1').profile.tagline, 'Updated profile');
  assert.equal(result.data.find((m) => m.id === 'shop-2').profile, null);
  const first = await read('?limit=1');
  const second = await read('?limit=1&offset=1');
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.data, ...second.data].map((m) => m.id)).size, 2);
  assert.equal((await fetch(url + '?limit=bad')).status, 400);
  assert.equal((await fetch(url + '?offset=1e100')).status, 400);
  // Keep shops beyond the store's default 100-row limit discoverable too.
  for (let i = 0; i < 101; i++) await store.insert('merchants', { id: `bulk-${i}`, name: `Shop ${i}` });
  const all = [];
  let more = true;
  while (more) {
    const page = await read(`?limit=100&offset=${all.length}`);
    all.push(...page.data);
    more = page.hasMore;
  }
  assert.equal(new Set(all.map((m) => m.id)).size, 103);
});
