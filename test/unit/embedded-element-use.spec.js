import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
  globalThis.localStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
});

import {
  SELECT_ELEMENT,
  SET_OPTIMAL_LOCATORS,
  SET_SELECTED_ELEMENT_ID,
  selectElement,
  useElementInRecorder,
} from '../../app/common/renderer/actions/SessionInspector.js';
import {
  acquireRecorderSend,
  confirmRecorderSelection,
  isValidRecorderSelection,
} from '../../app/common/renderer/components/SessionInspector/SourceTab/SelectedElement/EmbeddedRecorderSelection.jsx';
import {
  EMBEDDED_MESSAGE_TYPES,
  EMBEDDED_PROTOCOL_CHANNEL,
  EMBEDDED_PROTOCOL_VERSION,
  createEmbeddedBridge,
  setEmbeddedBridge,
} from '../../app/common/renderer/embedded/protocol.js';
import InspectorDriver from '../../app/common/renderer/lib/appium/inspector-driver.js';

const selectedElement = {
  path: '0',
  tagName: 'android.widget.Button',
  attributes: {'resource-id': 'login', text: 'Log in'},
  strategyMap: [
    ['id', 'login'],
    ['xpath', '//android.widget.Button'],
  ],
};

const createState = (overrides = {}) => ({
  inspector: {
    isEmbeddedMode: true,
    selectedElement,
    selectedElementId: 'element-123',
    screenshot: 'base64-screenshot',
    sourceXML: '<hierarchy />',
    ...overrides,
  },
});

describe('explicit embedded element use', function () {
  let postMessage;

  beforeEach(function () {
    postMessage = vi.fn();
    setEmbeddedBridge(createEmbeddedBridge({postMessage}, 'app://visual-recorder'));
  });

  afterEach(function () {
    setEmbeddedBridge(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('emits exactly once with the current user-selected strategy and value', function () {
    const state = createState();
    const payload = useElementInRecorder('xpath', '  //android.widget.Button[@text="Continue"]  ')(
      vi.fn(),
      () => state,
    );

    expect(payload.strategy).toBe('xpath');
    expect(payload.selector).toBe('//android.widget.Button[@text="Continue"]');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: EMBEDDED_PROTOCOL_CHANNEL,
        version: EMBEDDED_PROTOCOL_VERSION,
        type: EMBEDDED_MESSAGE_TYPES.ELEMENT_USED,
        payload,
      },
      'app://visual-recorder',
    );
  });

  it.each([
    [createState({selectedElement: undefined}), 'id', 'login'],
    [createState(), '', 'login'],
    [createState(), 'id', '   '],
  ])('rejects invalid confirmation state without emitting', function (state, strategy, selector) {
    expect(() => useElementInRecorder(strategy, selector)(vi.fn(), () => state)).toThrow(
      expect.objectContaining({code: 'INVALID_SELECTION'}),
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('disables confirmation unless element, strategy, and value are valid', function () {
    expect(isValidRecorderSelection(selectedElement, 'id', 'login')).toBe(true);
    expect(isValidRecorderSelection(undefined, 'id', 'login')).toBe(false);
    expect(isValidRecorderSelection(selectedElement, '', 'login')).toBe(false);
    expect(isValidRecorderSelection(selectedElement, 'id', ' ')).toBe(false);
  });

  it('prevents a duplicate confirmation while a send is in progress', function () {
    const isSendingRef = {current: false};
    const releaseSend = acquireRecorderSend(isSendingRef);

    expect(releaseSend).toBeTypeOf('function');
    expect(acquireRecorderSend(isSendingRef)).toBeNull();
    releaseSend();
    expect(acquireRecorderSend(isSendingRef)).toBeTypeOf('function');
  });

  it('shows success and error feedback without changing the selected element', async function () {
    const state = createState();
    const setIsSending = vi.fn();
    const setFeedback = vi.fn();
    const isSendingRef = {current: false};

    await confirmRecorderSelection({
      isSendingRef,
      selectedElement: state.inspector.selectedElement,
      strategy: 'id',
      selector: 'login',
      send: vi.fn().mockResolvedValue(undefined),
      setIsSending,
      setFeedback,
    });
    expect(setFeedback).toHaveBeenLastCalledWith({
      type: 'success',
      title: 'Elemento enviado al Recorder',
    });

    await confirmRecorderSelection({
      isSendingRef,
      selectedElement: state.inspector.selectedElement,
      strategy: 'id',
      selector: 'login',
      send: vi.fn().mockRejectedValue(new Error('Host unavailable')),
      setIsSending,
      setFeedback,
    });
    expect(setFeedback).toHaveBeenLastCalledWith({type: 'error', title: 'Host unavailable'});
    expect(state.inspector.selectedElement).toBe(selectedElement);
    expect(setIsSending).toHaveBeenLastCalledWith(false);
  });

  it('processes only one rapid confirmation', async function () {
    let finishSend;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    );
    const options = {
      isSendingRef: {current: false},
      selectedElement,
      strategy: 'id',
      selector: 'login',
      send,
      setIsSending: vi.fn(),
      setFeedback: vi.fn(),
    };

    const firstConfirmation = confirmRecorderSelection(options);
    const duplicateConfirmation = confirmRecorderSelection(options);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(duplicateConfirmation).resolves.toBe(false);
    finishSend();
    await expect(firstConfirmation).resolves.toBe(true);
  });

  it('ordinary embedded selection updates local state without emitting', async function () {
    vi.useFakeTimers();
    vi.spyOn(InspectorDriver, 'instance').mockReturnValue({
      run: vi.fn().mockResolvedValue({id: 'resolved-element'}),
    });
    const state = createState({
      selectedElement: undefined,
      selectedElementId: null,
      selectedElementPath: null,
      sourceJSON: {children: [selectedElement]},
      sourceXML: '<hierarchy><android.widget.Button resource-id="login" text="Log in" /></hierarchy>',
      expandedPaths: [],
      currentContext: 'NATIVE_APP',
      automationName: 'uiautomator2',
      driver: {},
      isUsingMjpegMode: false,
      isSourceRefreshOn: false,
      autoSessionRestart: false,
    });
    const dispatch = vi.fn((action) => {
      if (action.type === SELECT_ELEMENT) {
        state.inspector.selectedElement = action.selectedElement;
        state.inspector.selectedElementPath = action.selectedElement.path;
      } else if (action.type === SET_OPTIMAL_LOCATORS) {
        state.inspector.selectedElement.strategyMap = action.strategyMap;
      } else if (action.type === SET_SELECTED_ELEMENT_ID) {
        state.inspector.selectedElementId = action.elementId;
      }
    });

    await selectElement('0')(dispatch, () => state);
    await vi.runAllTimersAsync();

    expect(state.inspector.selectedElementPath).toBe('0');
    expect(state.inspector.selectedElementId).toBe('resolved-element');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('failed embedded element resolution also emits nothing', async function () {
    vi.useFakeTimers();
    vi.spyOn(InspectorDriver, 'instance').mockReturnValue({
      run: vi.fn().mockResolvedValue({}),
    });
    const state = createState({
      selectedElement: undefined,
      selectedElementId: null,
      selectedElementPath: null,
      sourceJSON: {children: [selectedElement]},
      sourceXML: '<hierarchy><android.widget.Button resource-id="login" text="Log in" /></hierarchy>',
      expandedPaths: [],
      currentContext: 'NATIVE_APP',
      automationName: 'uiautomator2',
      driver: {},
      isUsingMjpegMode: false,
      isSourceRefreshOn: false,
      autoSessionRestart: false,
    });
    const dispatch = vi.fn((action) => {
      if (action.type === SELECT_ELEMENT) {
        state.inspector.selectedElement = action.selectedElement;
        state.inspector.selectedElementPath = action.selectedElement.path;
      } else if (action.type === SET_OPTIMAL_LOCATORS) {
        state.inspector.selectedElement.strategyMap = action.strategyMap;
      }
    });

    await selectElement('0')(dispatch, () => state);
    await vi.runAllTimersAsync();

    expect(state.inspector.selectedElementId).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('preserves standalone selection and rejects recorder-only transfer', async function () {
    vi.useFakeTimers();
    vi.spyOn(InspectorDriver, 'instance').mockReturnValue({
      run: vi.fn().mockResolvedValue({id: 'standalone-element'}),
    });
    const state = createState({
      isEmbeddedMode: false,
      selectedElement: undefined,
      selectedElementId: null,
      selectedElementPath: null,
      sourceJSON: {children: [selectedElement]},
      sourceXML: '<hierarchy><android.widget.Button resource-id="login" text="Log in" /></hierarchy>',
      expandedPaths: [],
      currentContext: 'NATIVE_APP',
      automationName: 'uiautomator2',
      driver: {},
      isUsingMjpegMode: false,
      isSourceRefreshOn: false,
      autoSessionRestart: false,
    });
    const dispatch = vi.fn((action) => {
      if (action.type === SELECT_ELEMENT) {
        state.inspector.selectedElement = action.selectedElement;
        state.inspector.selectedElementPath = action.selectedElement.path;
      } else if (action.type === SET_OPTIMAL_LOCATORS) {
        state.inspector.selectedElement.strategyMap = action.strategyMap;
      } else if (action.type === SET_SELECTED_ELEMENT_ID) {
        state.inspector.selectedElementId = action.elementId;
      }
    });

    await selectElement('0')(dispatch, () => state);
    await vi.runAllTimersAsync();

    expect(state.inspector.selectedElementId).toBe('standalone-element');
    expect(() => useElementInRecorder('id', 'login')(dispatch, () => state)).toThrow(
      expect.objectContaining({code: 'NOT_EMBEDDED_MODE'}),
    );
    expect(postMessage).not.toHaveBeenCalled();
  });
});
