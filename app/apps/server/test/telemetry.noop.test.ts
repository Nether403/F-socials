// Feature: observability-instrumentation, Property 6: No_Op_Telemetry performs
// zero outbound emission and never throws.
// Validates: Requirements 3.4, 4.6, 9.6
//
// For any finite sequence of emit/capture calls with arbitrary names, contexts,
// and payloads, No_Op_Telemetry performs zero outbound network connections to a
// telemetry endpoint and returns from every call without throwing. We assert
// "zero outbound" concretely by counting every transport entry point
// (http/https request+get, net connect/createConnection, tls connect) for the
// duration of the run — the count must stay at exactly 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { noopTelemetry } from '../src/infra/telemetry/noop';

// Wrap every transport entry point with a counter so any outbound attempt is seen.
function installNetworkSpy() {
  let count = 0;
  const bump = (orig: (...a: never[]) => unknown) =>
    function (this: unknown, ...args: never[]) {
      count += 1;
      return orig.apply(this, args);
    };
  const originals = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    tlsConnect: tls.connect,
  };
  // @ts-expect-error - intentional monkeypatch for the test boundary
  http.request = bump(originals.httpRequest);
  // @ts-expect-error
  http.get = bump(originals.httpGet);
  // @ts-expect-error
  https.request = bump(originals.httpsRequest);
  // @ts-expect-error
  https.get = bump(originals.httpsGet);
  // @ts-expect-error
  net.connect = bump(originals.netConnect);
  // @ts-expect-error
  net.createConnection = bump(originals.netCreateConnection);
  // @ts-expect-error
  tls.connect = bump(originals.tlsConnect);

  return {
    get count() {
      return count;
    },
    restore() {
      http.request = originals.httpRequest;
      http.get = originals.httpGet;
      https.request = originals.httpsRequest;
      https.get = originals.httpsGet;
      net.connect = originals.netConnect;
      net.createConnection = originals.netCreateConnection;
      tls.connect = originals.tlsConnect;
    },
  };
}

// A single emit or capture invocation with arbitrary content.
const operation = fc.oneof(
  fc.record({
    kind: fc.constant<'emit'>('emit'),
    name: fc.string(),
    props: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
  }),
  fc.record({
    kind: fc.constant<'capture'>('capture'),
    error: fc.anything(),
    context: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
  }),
);

test('Property 6: No_Op_Telemetry never throws and opens zero connections', () => {
  const spy = installNetworkSpy();
  try {
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 50 }), (ops) => {
        for (const op of ops) {
          // Every call must return without throwing.
          if (op.kind === 'emit') {
            noopTelemetry.emit(op.name, op.props as Record<string, unknown> | undefined);
          } else {
            noopTelemetry.capture(op.error, op.context as Record<string, unknown> | undefined);
          }
        }
        // No outbound transport was ever touched across the whole sequence.
        return spy.count === 0;
      }),
      { numRuns: 200 },
    );
    assert.equal(spy.count, 0, 'No_Op_Telemetry must open zero connections');
  } finally {
    spy.restore();
  }
});
