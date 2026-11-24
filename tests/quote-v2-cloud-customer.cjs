const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../portal/quote-v2.html', `file://${__filename}`), 'utf8');
const start = html.indexOf('  async function saveClientToCloud(button) {');
const end = html.indexOf('  async function aiRecognize(lv) {', start);
assert(start > 0 && end > start, 'cloud save handler exists');
const source = html.slice(start, end) + '\nglobalThis.run = saveClientToCloud;';

async function scenario({ session = true, existing = [], lookupError = null, insertError = null } = {}) {
  const fields = { name: { value: 'Alice' }, phone: { value: '012-345 6789' }, address: { value: 'Johor Bahru' } };
  const status = { textContent: '', style: {} };
  const button = { disabled: false, textContent: '' };
  const calls = [];
  const sb = {
    auth: { getSession: async () => ({ data: { session: session ? { user: { id: 'staff' } } : null }, error: null }) },
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: existing, error: lookupError }; },
    from: table => ({ insert: data => {
      calls.push(['insert', table, data]);
      return { select: () => ({ single: async () => ({ data: insertError ? null : { id: 'customer-1' }, error: insertError }) }) };
    } }),
  };
  const context = {
    P: { info: {} }, uiLang: 'zh',
    document: { querySelector: selector => selector === '[data-client-save-status]' ? status : fields[selector.match(/data-info="(.*?)"/)?.[1]] },
    save: () => calls.push(['local-save']),
    requireClientInfo: () => true,
    sbClient: async () => sb,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.run(button);
  return { status: status.textContent, button, calls };
}

(async () => {
  const saved = await scenario();
  assert.equal(saved.calls.find(call => call[0] === 'rpc')[2].p_phone, '60123456789');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.calls.find(call => call[0] === 'insert')[2])), {
    name: 'Alice', phone: '60123456789', address: 'Johor Bahru',
  });
  assert.match(saved.status, /已保存到员工系统/);
  assert.equal(saved.button.disabled, false);

  const duplicate = await scenario({ existing: [{ id: 'customer-1', name: 'Alice', address: 'Johor Bahru' }] });
  assert.equal(duplicate.calls.some(call => call[0] === 'insert'), false);
  assert.match(duplicate.status, /已保存在云端/);

  const noSession = await scenario({ session: false });
  assert.equal(noSession.calls.some(call => call[0] === 'insert'), false);
  assert.match(noSession.status, /请先登录员工系统/);

  const failed = await scenario({ insertError: { message: 'permission denied' } });
  assert.match(failed.status, /云端保存失败：permission denied/);
  console.log('quote-v2 cloud customer save: 4 scenarios passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
