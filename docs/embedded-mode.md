# Embedded Mode

Embedded mode lets a trusted host application display the Inspector while retaining ownership of an
existing Appium session. The Inspector attaches with WebdriverIO's `attachToSession` API and never
deletes an externally owned session.

## Build and Host

Run `npm run build:browser`. The embeddable entry point is `dist-browser/embedded.html`; serve the
entire `dist-browser` directory over HTTP(S). The Appium server must allow requests from the
Inspector bundle's origin.

Load the entry point in an iframe in the Electron renderer with Node integration disabled. By
default, the parent and Inspector must have the same origin. For a cross-origin deployment, bake
the one trusted parent origin into the bundle:

```sh
VITE_EMBEDDED_HOST_ORIGIN=app://visual-recorder npm run build:browser
```

Session details and trusted origins are never accepted from URL parameters. Opaque Inspector
origins are rejected; serve the bundle from an HTTP(S) or registered Electron custom-scheme origin.

## Host Handshake

All messages use channel `appium-inspector:embedded` and protocol version `1`. The Inspector accepts
messages only from its parent window and the configured exact origin.

Wait for `appium-inspector:ready`, then send:

```js
inspectorFrame.contentWindow.postMessage(
  {
    channel: 'appium-inspector:embedded',
    version: 1,
    type: 'appium-inspector:connect',
    payload: {
      serverUrl: 'http://127.0.0.1:4723',
      sessionId: recorderSessionId,
      capabilities: recorderCapabilities,
      platform: 'Android',
    },
  },
  inspectorOrigin,
);
```

The Inspector responds with `appium-inspector:connected` or `appium-inspector:error`. Selecting an
element emits `appium-inspector:element-selected`:

```ts
interface ElementSelectedPayload {
  strategy: string;
  selector: string;
  elementId?: string;
  tag?: string;
  attributes: Record<string, string>;
  screenshot?: string;
  source?: string;
}
```

The complete typed protocol is exported from
`app/common/renderer/embedded/protocol.ts`. Hosts should validate the Inspector message source,
origin, channel, version, and type before consuming a payload.
