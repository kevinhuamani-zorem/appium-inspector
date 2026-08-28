export const EMBEDDED_PROTOCOL_CHANNEL = 'appium-inspector:embedded';
export const EMBEDDED_PROTOCOL_VERSION = 1;

export const EMBEDDED_MESSAGE_TYPES = {
  CONNECT: 'appium-inspector:connect',
  READY: 'appium-inspector:ready',
  CONNECTED: 'appium-inspector:connected',
  ERROR: 'appium-inspector:error',
  ELEMENT_SELECTED: 'appium-inspector:element-selected',
} as const;

export type EmbeddedCapabilities = Record<string, unknown>;

export interface EmbeddedConnectPayload {
  serverUrl: string;
  sessionId: string;
  capabilities: EmbeddedCapabilities;
  platform: string;
}

export interface EmbeddedElementSelectionPayload {
  strategy: string;
  selector: string;
  elementId?: string;
  tag?: string;
  attributes: Record<string, string>;
  screenshot?: string;
  source?: string;
}

export interface EmbeddedMessage<TType extends string, TPayload = undefined> {
  channel: typeof EMBEDDED_PROTOCOL_CHANNEL;
  version: typeof EMBEDDED_PROTOCOL_VERSION;
  type: TType;
  payload?: TPayload;
}

export class EmbeddedProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddedProtocolError';
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EmbeddedProtocolError('INVALID_PAYLOAD', `'${field}' must be a non-empty string`);
  }
  return value;
};

export function validateConnectMessage(data: unknown): EmbeddedConnectPayload {
  if (!isPlainObject(data)) {
    throw new EmbeddedProtocolError('INVALID_MESSAGE', 'Message must be an object');
  }
  if (data.channel !== EMBEDDED_PROTOCOL_CHANNEL || data.version !== EMBEDDED_PROTOCOL_VERSION) {
    throw new EmbeddedProtocolError('UNSUPPORTED_PROTOCOL', 'Unsupported embedded protocol channel or version');
  }
  if (data.type !== EMBEDDED_MESSAGE_TYPES.CONNECT) {
    throw new EmbeddedProtocolError('INVALID_MESSAGE_TYPE', `Unsupported message type '${String(data.type)}'`);
  }
  if (!isPlainObject(data.payload)) {
    throw new EmbeddedProtocolError('INVALID_PAYLOAD', "'payload' must be an object");
  }

  const serverUrl = requireNonEmptyString(data.payload.serverUrl, 'serverUrl');
  let parsedServerUrl: URL;
  try {
    parsedServerUrl = new URL(serverUrl);
  } catch {
    throw new EmbeddedProtocolError('INVALID_PAYLOAD', "'serverUrl' must be a valid URL");
  }
  if (!['http:', 'https:'].includes(parsedServerUrl.protocol)) {
    throw new EmbeddedProtocolError('INVALID_PAYLOAD', "'serverUrl' must use HTTP or HTTPS");
  }
  if (!isPlainObject(data.payload.capabilities)) {
    throw new EmbeddedProtocolError('INVALID_PAYLOAD', "'capabilities' must be an object");
  }

  return {
    serverUrl: parsedServerUrl.toString().replace(/\/$/, ''),
    sessionId: requireNonEmptyString(data.payload.sessionId, 'sessionId'),
    capabilities: data.payload.capabilities,
    platform: requireNonEmptyString(data.payload.platform, 'platform'),
  };
}

export function resolveHostOrigin(locationUrl: string, configuredOrigin?: string): string {
  const url = new URL(locationUrl);
  if (!configuredOrigin) {
    if (url.origin === 'null') {
      throw new EmbeddedProtocolError(
        'HOST_ORIGIN_REQUIRED',
        "'hostOrigin' is required when the embedded bundle has an opaque origin",
      );
    }
    return url.origin;
  }

  let hostOrigin: URL;
  try {
    hostOrigin = new URL(configuredOrigin);
  } catch {
    throw new EmbeddedProtocolError('INVALID_HOST_ORIGIN', "'hostOrigin' must be an absolute origin");
  }
  if (
    !hostOrigin.hostname ||
    ['data:', 'file:', 'javascript:'].includes(hostOrigin.protocol) ||
    !['', '/'].includes(hostOrigin.pathname) ||
    hostOrigin.search ||
    hostOrigin.hash
  ) {
    throw new EmbeddedProtocolError('INVALID_HOST_ORIGIN', "'hostOrigin' must not include a path, query, or hash");
  }
  return `${hostOrigin.protocol}//${hostOrigin.host}`;
}

export function validateHostMessage(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  parentWindow: Window,
  hostOrigin: string,
): EmbeddedConnectPayload {
  if (event.source !== parentWindow) {
    throw new EmbeddedProtocolError('INVALID_SOURCE', 'Message did not come from the embedding window');
  }
  if (event.origin !== hostOrigin) {
    throw new EmbeddedProtocolError('INVALID_ORIGIN', `Message origin '${event.origin}' is not trusted`);
  }
  return validateConnectMessage(event.data);
}

type HostMessageType =
  | typeof EMBEDDED_MESSAGE_TYPES.READY
  | typeof EMBEDDED_MESSAGE_TYPES.CONNECTED
  | typeof EMBEDDED_MESSAGE_TYPES.ERROR
  | typeof EMBEDDED_MESSAGE_TYPES.ELEMENT_SELECTED;

export interface EmbeddedBridge {
  post<TPayload>(type: HostMessageType, payload?: TPayload): void;
}

export function createEmbeddedBridge(parentWindow: Window, hostOrigin: string): EmbeddedBridge {
  return {
    post(type, payload) {
      parentWindow.postMessage(
        {
          channel: EMBEDDED_PROTOCOL_CHANNEL,
          version: EMBEDDED_PROTOCOL_VERSION,
          type,
          ...(payload === undefined ? {} : {payload}),
        },
        hostOrigin,
      );
    },
  };
}

let activeBridge: EmbeddedBridge | null = null;

export function setEmbeddedBridge(bridge: EmbeddedBridge | null): void {
  activeBridge = bridge;
}

export function emitElementSelected(payload: EmbeddedElementSelectionPayload): void {
  activeBridge?.post(EMBEDDED_MESSAGE_TYPES.ELEMENT_SELECTED, payload);
}
