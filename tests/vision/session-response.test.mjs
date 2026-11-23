import test from 'node:test';
import assert from 'node:assert/strict';
import { readSessionId } from '../../scripts/session-response.mjs';

test('仅接受非空合法 Session 标识，不将异常响应作为后续路径', () => {
  assert.equal(readSessionId({ id: 'sess_019e3bb1e8c171fd9abbb1477ffb84cc' }), 'sess_019e3bb1e8c171fd9abbb1477ffb84cc');
  for (const malformed of [null, [], {}, { id: undefined }, { id: 123 }, { id: '' }, { id: '  ' }, { id: '../x' }, { id: 'a/b' }, { id: 'a?b' }, { id: 'x'.repeat(129) }]) {
    assert.equal(readSessionId(malformed), null);
  }
});
