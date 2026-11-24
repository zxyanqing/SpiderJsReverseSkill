'use strict';

// Executable diagnostic examples, not a browser emulator or site acceptance suite.
// Each invariant accepts a valid composition and detects a corresponding fault.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

function makeInterface(overwrite = false) {
  const records = new WeakMap();
  class Entry {
    constructor(value) { records.set(this, value); }
    read() {
      if (!records.has(this)) throw new TypeError('Illegal invocation');
      return records.get(this);
    }
  }
  const scope = { Entry, create: value => new Entry(value) };
  // A later installer replaces the public interface but not its factory.
  if (overwrite) scope.Entry = class Entry {};
  return scope;
}

function probePublicInterface(scope) {
  const item = scope.create(7);
  assert.equal(typeof scope.Entry.prototype.read, 'function');
  assert.equal(item.constructor, scope.Entry);
  assert.ok(item instanceof scope.Entry);
  assert.equal(scope.Entry.prototype.read.call(item), 7);
  assert.throws(() => scope.Entry.prototype.read.call({}), TypeError);
}

test('negative-only TypeError checks can pass for a missing method', () => {
  const broken = makeInterface(true);
  assert.throws(() => broken.Entry.prototype.read.call({}), TypeError);
  assert.throws(() => probePublicInterface(broken), assert.AssertionError);
  probePublicInterface(makeInterface());
});

test('same names and working instances do not prove correct public installation', () => {
  const broken = makeInterface(true);
  const item = broken.create(7);
  assert.equal(item.constructor.name, broken.Entry.name);
  assert.equal(item.read(), 7);
  assert.throws(() => probePublicInterface(broken), assert.AssertionError);
  probePublicInterface(makeInterface());
});

function probeRealmIsolation(shared) {
  const parent = vm.createContext({});
  const child = vm.createContext({});
  vm.runInContext('globalThis.Resource = class Resource {}; Resource.read = function read() {};', parent);
  const before = parent.Resource.read;
  if (shared) child.Resource = parent.Resource;
  else vm.runInContext('globalThis.Resource = class Resource {};', child);
  vm.runInContext('Resource.read = function read() { throw new TypeError("child"); };', child);
  assert.equal(parent.Resource.read, before);
  assert.notEqual(parent.Resource, child.Resource);
  assert.equal(vm.runInContext('Resource.read instanceof Function', parent), true);
  assert.equal(vm.runInContext('Resource.read instanceof Function', child), true);
}

test('creating a child must preserve parent interfaces in an isolated-realm contract', () => {
  probeRealmIsolation(false);
  assert.throws(() => probeRealmIsolation(true), assert.AssertionError);
});

function makeState(split) {
  let size = 4;
  const attrs = { size: '4' };
  return {
    get size() { return size; },
    set size(value) { size = Number(value); attrs.size = String(value); },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (!split && name === 'size') size = Number(value);
    },
    getAttribute(name) { return attrs[name]; },
  };
}

function probeState(value) {
  value.size = 8;
  assert.equal(value.getAttribute('size'), '8');
  value.setAttribute('size', '13');
  assert.equal(value.size, 13);
}

test('checking both mutation entrances exposes split internal state', () => {
  probeState(makeState(false));
  assert.throws(() => probeState(makeState(true)), assert.AssertionError);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function runDelivery(waitForResult) {
  const deliver = deferred();
  const trace = [];
  let closed = false;
  let output;
  const pending = deliver.promise.then(() => {
    if (!closed) { output = 'ready'; trace.push('delivered'); }
  });
  // The timer queue is empty; a different task source still owns the result.
  await Promise.resolve();
  if (waitForResult) {
    deliver.resolve();
    await pending;
  }
  const snapshot = { complete: output !== undefined, value: output };
  closed = true;
  trace.push('disposed');
  deliver.resolve();
  await pending;
  return { snapshot, trace };
}

function probeDelivery(result) {
  assert.deepEqual(result.snapshot, { complete: true, value: 'ready' });
  assert.deepEqual(result.trace, ['delivered', 'disposed']);
}

test('an empty timer queue is insufficient to declare an async result complete', async () => {
  probeDelivery(await runDelivery(true));
  const broken = await runDelivery(false);
  assert.deepEqual(broken, { snapshot: { complete: false, value: undefined }, trace: ['disposed'] });
  assert.throws(() => probeDelivery(broken), assert.AssertionError);
});

function request(url, data) {
  return new Promise((resolve, reject) => {
    const body = data === undefined ? null : JSON.stringify(data);
    const req = http.request(url, {
      method: body === null ? 'GET' : 'POST',
      headers: body === null ? {} : { 'content-type': 'application/json' },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Loopback fixture timeout')));
    req.end(body);
  });
}

test('loopback consumer distinguishes current local output, stale input and later state', async () => {
  const sessions = new Map();
  const received = [];
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') {
      const session = randomUUID();
      const input = randomUUID();
      sessions.set(session, [...input].reverse().join(''));
      res.end(JSON.stringify({ session, input, source: 'globalThis.output = [...input].reverse().join("");' }));
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        received.push(data);
        const accepted = sessions.has(data.session) && sessions.get(data.session) === data.output;
        res.end(JSON.stringify({ accepted, page: accepted ? 'result' : 'challenge' }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ accepted: false }));
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const first = (await request(url)).data;
    const context = vm.createContext({ input: first.input });
    new vm.Script(first.source).runInContext(context);
    const consumedSnapshot = { session: first.session, output: context.output };
    vm.runInContext('output = "later-phase";', context);
    const later = await request(url, { session: first.session, output: context.output });
    assert.equal(later.status, 200);
    assert.equal(later.data.accepted, false);
    const valid = await request(url, consumedSnapshot);
    assert.equal(valid.data.accepted, true);
    assert.deepEqual(received[1], consumedSnapshot);
    const second = (await request(url)).data;
    const stale = await request(url, { session: second.session, output: consumedSnapshot.output });
    assert.equal(stale.data.accepted, false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
