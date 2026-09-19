import {describe, expect, it, vi} from 'vitest';

import {
  analysisNodes,
  explorerTree,
  nodePreviewRect,
} from '../../app/common/renderer/components/SessionInspector/SourceTab/ElementExplorer/element-explorer-view.js';
import {
  createElementAnalysisClient,
  ELEMENT_ANALYSIS_TYPES,
} from '../../app/common/renderer/embedded/element-explorer-client.js';
import {EMBEDDED_PROTOCOL_CHANNEL, EMBEDDED_PROTOCOL_VERSION} from '../../app/common/renderer/embedded/protocol.js';

const snapshot = {
  snapshotId: 'snapshot-1',
  sessionId: 'session-1',
  platform: 'android',
  context: 'NATIVE_APP',
  sourceXml: '<hierarchy/>',
  nodes: [
    {nodeId: '', parentId: null, tag: 'hierarchy', attributes: {}, candidates: []},
    {
      nodeId: '0',
      parentId: '',
      tag: 'Button',
      attributes: {text: 'Pagar'},
      candidates: [{id: 'id-pay', strategy: 'id', selector: 'pay'}],
    },
  ],
};

function setup() {
  let receive;
  let nextId = 0;
  const parentWindow = {postMessage: vi.fn()};
  const targetWindow = {
    addEventListener: vi.fn((_name, listener) => {
      receive = listener;
    }),
    removeEventListener: vi.fn(),
  };
  const onUpdate = vi.fn();
  const client = createElementAnalysisClient({
    targetWindow,
    parentWindow,
    hostOrigin: 'appium-recorder://host',
    onUpdate,
    makeId: () => 'request-' + ++nextId,
  });
  function deliver(payload, overrides = {}) {
    receive({
      source: parentWindow,
      origin: 'appium-recorder://host',
      data: {
        channel: EMBEDDED_PROTOCOL_CHANNEL,
        version: EMBEDDED_PROTOCOL_VERSION,
        type: ELEMENT_ANALYSIS_TYPES.UPDATE,
        payload: {
          requestId: 'request-1',
          snapshotId: 'snapshot-1',
          status: 'running',
          phase: 'Analizando',
          processed: 1,
          total: 2,
          ...payload,
        },
      },
      ...overrides,
    });
  }
  return {client, onUpdate, parentWindow, targetWindow, deliver};
}

describe('element explorer analysis lifecycle', () => {
  it('sends all nodes, including the root, through the existing restricted bridge', () => {
    const app = setup();
    expect(app.client.start(snapshot)).toBe('request-1');
    expect(app.parentWindow.postMessage).toHaveBeenCalledWith(
      {
        channel: EMBEDDED_PROTOCOL_CHANNEL,
        version: 3,
        type: ELEMENT_ANALYSIS_TYPES.REQUEST,
        payload: {...snapshot, requestId: 'request-1'},
      },
      'appium-recorder://host',
    );
    app.client.dispose();
  });

  it('ignores other frames, origins, requests and captures', () => {
    const app = setup();
    app.client.start(snapshot);
    app.deliver({}, {source: {}});
    app.deliver({}, {origin: 'https://untrusted.example'});
    app.deliver({requestId: 'other'});
    app.deliver({snapshotId: 'other'});
    expect(app.onUpdate).not.toHaveBeenCalled();
    app.deliver({});
    expect(app.onUpdate).toHaveBeenCalledOnce();
    app.client.dispose();
  });

  it('accepts partial results only for existing nodes and candidate IDs, including the root', () => {
    const app = setup();
    app.client.start(snapshot);
    const root = {nodeId: '', suggestedName: 'Pantalla', recommendedCandidateId: null, reason: 'Contenedor'};
    const known = {nodeId: '0', suggestedName: 'Pagar', recommendedCandidateId: 'id-pay', reason: 'Identificador'};
    app.deliver({
      results: [root, known, {...known, nodeId: 'invented'}, {...known, recommendedCandidateId: 'invented'}],
    });
    expect(app.onUpdate).toHaveBeenCalledWith(expect.objectContaining({results: [root, known]}));
    app.client.dispose();
  });

  it('cancels the current request before retry and ignores late answers from the earlier one', () => {
    const app = setup();
    app.client.start(snapshot);
    app.client.start(snapshot);
    expect(app.parentWindow.postMessage.mock.calls[1][0]).toMatchObject({
      type: ELEMENT_ANALYSIS_TYPES.CANCEL,
      payload: {requestId: 'request-1', snapshotId: 'snapshot-1'},
    });
    app.deliver({status: 'completed'});
    expect(app.onUpdate).not.toHaveBeenCalled();
    app.deliver({requestId: 'request-2', status: 'completed', processed: 2, total: 2});
    expect(app.onUpdate).toHaveBeenCalledOnce();
    app.deliver({requestId: 'request-2'});
    expect(app.onUpdate).toHaveBeenCalledOnce();
    app.client.dispose();
  });

  it('removes its listener and ignores answers after closing', () => {
    const app = setup();
    app.client.start(snapshot);
    app.client.dispose();
    app.deliver({status: 'completed'});
    expect(app.onUpdate).not.toHaveBeenCalled();
    expect(app.targetWindow.removeEventListener).toHaveBeenCalledOnce();
    expect(() => app.client.start(snapshot)).toThrow('El explorador ya está cerrado');
  });
});

describe('complete source tree filtering', () => {
  const catalog = {
    nodes: [
      {...snapshot.nodes[0], label: 'hierarchy', visible: null, interactive: false},
      {...snapshot.nodes[1], label: 'Pagar', visible: true, interactive: true},
      {
        nodeId: '1',
        parentId: '',
        tag: 'View',
        attributes: {text: 'Oculto'},
        label: 'Oculto',
        candidates: [],
        visible: false,
        interactive: false,
      },
    ],
  };

  it('preserves every node without filters and keeps ancestors when searching a leaf', () => {
    const all = explorerTree(catalog);
    expect(all.matchingCount).toBe(3);
    expect(all.treeData[0].key).toBe('');
    expect(all.treeData[0].children.map(({key}) => key)).toEqual(['0', '1']);
    const filtered = explorerTree(catalog, 'Pagar');
    expect(filtered.matchingCount).toBe(1);
    expect(filtered.treeData[0].key).toBe('');
    expect(filtered.treeData[0].children.map(({key}) => key)).toEqual(['0']);
  });

  it('filters explicitly and produces a compact analysis payload without changing XML attributes', () => {
    const filtered = explorerTree(catalog, '', 'visible');
    expect(filtered.matchingCount).toBe(1);
    expect(analysisNodes(catalog).map(({nodeId}) => nodeId)).toEqual(['', '0', '1']);
    expect(analysisNodes(catalog)[1].attributes).toEqual({text: 'Pagar'});
    expect(analysisNodes(catalog)[1]).not.toHaveProperty('visible');
  });
});

describe('screenshot node highlight', () => {
  it('maps Android bounds and iOS coordinates to the captured viewport', () => {
    expect(nodePreviewRect({attributes: {bounds: '[10,20][40,60]'}}, {width: 100, height: 100})).toEqual({
      left: '10%',
      top: '20%',
      width: '30%',
      height: '40%',
    });
    expect(
      nodePreviewRect({attributes: {x: '10', y: '20', width: '30', height: '40'}}, {width: 100, height: 100}),
    ).toEqual({left: '10%', top: '20%', width: '30%', height: '40%'});
    expect(nodePreviewRect({attributes: {}}, {width: 100, height: 100})).toBeNull();
  });
});
