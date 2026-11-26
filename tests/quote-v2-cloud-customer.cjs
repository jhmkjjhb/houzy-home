const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../portal/quote-v2.html', `file://${__filename}`), 'utf8');
const start = html.indexOf('  async function saveClientToCloud(button) {');
const end = html.indexOf('  const cloudStatus = ', start);
assert(start > 0 && end > start, 'cloud save handler exists');
const source = html.slice(start, end) + '\nglobalThis.run = saveClientToCloud;';

async function scenario({ session = true, existing = [], lookupError = null, insertError = null, answer = true, updated = [{ id: 'customer-1' }] } = {}) {
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
    }, update: data => ({ eq: (col, id) => ({ select: async () => { calls.push(['update', table, data, id]); return { data: updated, error: null }; } }) }) }),
  };
  const context = {
    P: { info: {} }, uiLang: 'zh',
    document: { querySelector: selector => selector === '[data-client-save-status]' ? status : fields[selector.match(/data-info="(.*?)"/)?.[1]] },
    save: () => calls.push(['local-save']),
    requireClientInfo: () => true,
    confirm: () => { calls.push(['confirm']); return answer; },
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

  // 同一手机号、资料不同：问一次再覆盖（老板要求可以直接覆盖，但不能悄悄改掉）
  const differ = { existing: [{ id: 'customer-1', name: 'Alice Old', address: 'Old addr' }] };
  const over = await scenario(differ);
  assert.ok(over.calls.some(c => c[0] === 'confirm'), '覆盖前要确认');
  assert.deepEqual(JSON.parse(JSON.stringify(over.calls.find(c => c[0] === 'update').slice(2))), [{ name: 'Alice', address: 'Johor Bahru' }, 'customer-1']);
  assert.match(over.status, /已覆盖云端客户档案/);
  const no = await scenario({ ...differ, answer: false });
  assert.equal(no.calls.some(c => c[0] === 'update'), false, '选取消就不能改');
  assert.match(no.status, /没有覆盖/);
  const denied = await scenario({ ...differ, updated: [] });
  assert.match(denied.status, /没有权限覆盖/, '同事建的客户改不了要说清楚，不能显示成功');

  const noSession = await scenario({ session: false });
  assert.equal(noSession.calls.some(call => call[0] === 'insert'), false);
  assert.match(noSession.status, /请先登录员工系统/);

  const failed = await scenario({ insertError: { message: 'permission denied' } });
  assert.match(failed.status, /云端保存失败：permission denied/);
  console.log('quote-v2 cloud customer save: 7 scenarios passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
