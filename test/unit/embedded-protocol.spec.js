import {describe, expect, it, vi} from 'vitest';

import {
  EMBEDDED_MESSAGE_TYPES,
  EMBEDDED_PROTOCOL_CHANNEL,
  EMBEDDED_PROTOCOL_VERSION,
  createEmbeddedBridge,
  resolveHostOrigin,
  validateConnectMessage,
  validateHostMessage,
} from '../../app/common/renderer/embedded/protocol.js';

const validMessage = {
  channel: EMBEDDED_PROTOCOL_CHANNEL,
  version: EMBEDDED_PROTOCOL_VERSION,
  type: EMBEDDED_MESSAGE_TYPES.CONNECT,
  payload: {
    serverUrl: 'http://127.0.0.1:4723',
    sessionId: 'recorder-session',
    capabilities: {platformName: 'Android'},
    platform: 'Android',
  },
};

describe('embedded bridge protocol', function () {
  it('validates and normalizes a connection handshake', function () {
    expect(validateConnectMessage(validMessage)).toEqual(validMessage.payload);
  });

  it.each([
    [{...validMessage, version: 2}, 'UNSUPPORTED_PROTOCOL'],
    [{...validMessage, payload: {...validMessage.payload, sessionId: ''}}, 'INVALID_PAYLOAD'],
    [{...validMessage, payload: {...validMessage.payload, capabilities: []}}, 'INVALID_PAYLOAD'],
    [{...validMessage, payload: {...validMessage.payload, serverUrl: 'file:///tmp/appium'}}, 'INVALID_PAYLOAD'],
  ])('rejects malformed handshakes', function (message, code) {
    expect(() => validateConnectMessage(message)).toThrow(
      expect.objectContaining({
        code,
      }),
    );
  });

  it('requires the configured parent window and exact origin', function () {
    const parentWindow = {};
    expect(() =>
      validateHostMessage(
        {source: {}, origin: 'app://visual-recorder', data: validMessage},
        parentWindow,
        'app://visual-recorder',
      ),
    ).toThrow(expect.objectContaining({code: 'INVALID_SOURCE'}));
    expect(() =>
      validateHostMessage(
        {source: parentWindow, origin: 'https://attacker.example', data: validMessage},
        parentWindow,
        'app://visual-recorder',
      ),
    ).toThrow(expect.objectContaining({code: 'INVALID_ORIGIN'}));
  });

  it('uses an explicit host origin without accepting paths', function () {
    expect(resolveHostOrigin('https://inspector.example/embedded.html', 'app://visual-recorder')).toBe(
      'app://visual-recorder',
    );
    expect(() => resolveHostOrigin('https://inspector.example/embedded.html', 'https://host.example/path')).toThrow(
      expect.objectContaining({code: 'INVALID_HOST_ORIGIN'}),
    );
  });

  it('does not accept a trusted origin from the page URL', function () {
    expect(resolveHostOrigin('https://inspector.example/embedded.html?hostOrigin=https://attacker.example')).toBe(
      'https://inspector.example',
    );
  });

  it('posts versioned messages only to the trusted origin', function () {
    const postMessage = vi.fn();
    const bridge = createEmbeddedBridge({postMessage}, 'app://visual-recorder');
    bridge.post(EMBEDDED_MESSAGE_TYPES.READY);
    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: EMBEDDED_PROTOCOL_CHANNEL,
        version: EMBEDDED_PROTOCOL_VERSION,
        type: EMBEDDED_MESSAGE_TYPES.READY,
      },
      'app://visual-recorder',
    );
  });
});
