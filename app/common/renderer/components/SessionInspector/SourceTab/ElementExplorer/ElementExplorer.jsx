import {IconBinaryTree, IconRefresh} from '@tabler/icons-react';
import {Alert, Button, Empty, Input, Modal, Select, Space, Spin, Table, Tag, Tooltip, Tree, Typography} from 'antd';
import {useEffect, useMemo, useRef, useState} from 'react';

import {NATIVE_APP} from '../../../../constants/session-inspector.js';
import {createElementAnalysisClient} from '../../../../embedded/element-explorer-client.js';
import {buildElementCatalog} from '../../../../utils/locator-generation/element-explorer.js';
import {
  analysisNodes,
  elementCandidates,
  explorerTree,
  initialExplorerSelection,
  nodePreviewRect,
} from './element-explorer-view.js';

import styles from './ElementExplorer.module.css';

const {Text, Paragraph} = Typography;
const idleAnalysis = {status: 'idle', phase: '', processed: 0, total: 0};
const filters = [
  {value: 'all', label: 'Todos los nodos'},
  {value: 'visible', label: 'Visibles'},
  {value: 'interactive', label: 'Interactivos'},
  {value: 'ambiguous', label: 'Con locators ambiguos'},
];

export function ElementExplorerModal({
  sourceXML,
  sourceJSON,
  sourceError,
  screenshot,
  windowSize,
  currentContext,
  automationName,
  driver,
  sessionCaps,
  selectedElement,
  methodCallInProgress,
  verifyExplorerLocator,
  applyClientMethod,
  onClose,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [captureError, setCaptureError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [analysis, setAnalysis] = useState(idleAnalysis);
  const [recommendations, setRecommendations] = useState({});
  const [locatorContracts, setLocatorContracts] = useState({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expandedKeys, setExpandedKeys] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [candidateId, setCandidateId] = useState(null);
  const [verification, setVerification] = useState(null);
  const [sending, setSending] = useState(false);
  const clientRef = useRef(null);
  const analysisOperationRef = useRef(0);
  const initialPathRef = useRef(selectedElement?.path);
  const operationRef = useRef(0);
  const snapshotRef = useRef(null);
  const currentRef = useRef(null);
  const platform = String(sessionCaps?.platformName || driver?.capabilities?.platformName || '').toLowerCase();
  const sessionId = driver?.sessionId || '';
  const native = currentContext === NATIVE_APP;
  currentRef.current = {sourceXML, sourceJSON, currentContext, sessionId, refreshing, selectedNodeId};
  snapshotRef.current = snapshot;

  useEffect(() => {
    operationRef.current++;
    analysisOperationRef.current++;
    clientRef.current?.dispose();
    clientRef.current = null;
    setSnapshot(null);
    setCaptureError('');
    setSelectedNodeId(null);
    setCandidateId(null);
    setVerification(null);
    setSending(false);
    setRecommendations({});
    setLocatorContracts({});
    setAnalysis(idleAnalysis);
    if (refreshing) {
      return;
    }
    if (!native || !['android', 'ios'].includes(platform)) {
      setCaptureError('El explorador admite contexto nativo Android e iOS. Cambia a NATIVE_APP para analizarlo.');
      return;
    }
    if (sourceError) {
      setCaptureError('No se pudo obtener el XML de esta pantalla. Actualiza la captura para continuar.');
      return;
    }
    if (!sourceXML || !sessionId) {
      setCaptureError('No hay una captura de la sesión disponible. Actualiza la pantalla e inténtalo de nuevo.');
      return;
    }
    const timer = setTimeout(() => {
      try {
        const catalog = buildElementCatalog(sourceXML, true, automationName);
        if (!catalog.nodes.length) {
          throw new Error('El XML no contiene nodos para explorar.');
        }
        setSnapshot({
          snapshotId: crypto.randomUUID(),
          sourceXml: sourceXML,
          sourceJSON,
          screenshot,
          windowSize,
          context: currentContext,
          sessionId,
          platform,
          catalog,
          capturedAt: new Date().toLocaleTimeString(),
        });
        const selection = initialExplorerSelection(catalog, initialPathRef.current);
        initialPathRef.current = undefined;
        setSelectedNodeId(selection.nodeId);
        setCandidateId(selection.candidateId);
        setExpandedKeys(selection.expandedKeys);
      } catch (error) {
        setCaptureError(error.message);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [
    sourceXML,
    sourceJSON,
    sourceError,
    screenshot,
    windowSize,
    currentContext,
    automationName,
    sessionId,
    platform,
    native,
    refreshVersion,
    refreshing,
  ]);

  useEffect(
    () => () => {
      operationRef.current++;
      analysisOperationRef.current++;
      snapshotRef.current = null;
      clientRef.current?.dispose();
    },
    [],
  );

  const tree = useMemo(() => explorerTree(snapshot?.catalog, query, filter), [snapshot, query, filter]);
  const node = snapshot?.catalog.nodes.find((entry) => entry.nodeId === selectedNodeId);
  const recommendation = node ? recommendations[node.nodeId] : undefined;
  const candidates = elementCandidates(node, recommendation?.proposals);
  const candidate = candidates.find((entry) => entry.id === candidateId);
  const candidateContract =
    node && candidate ? locatorContracts[JSON.stringify([node.nodeId, candidate.id])] : undefined;
  const previewRect = snapshot ? nodePreviewRect(node, snapshot.windowSize) : null;
  const stale =
    !snapshot ||
    snapshot.sourceXml !== sourceXML ||
    snapshot.sourceJSON !== sourceJSON ||
    snapshot.context !== currentContext ||
    snapshot.sessionId !== sessionId ||
    refreshing;
  const analysisRunning = analysis.status === 'running';

  const handleSelectNode = (keys) => {
    operationRef.current++;
    analysisOperationRef.current++;
    clientRef.current?.dispose();
    clientRef.current = null;
    setRecommendations({});
    setLocatorContracts({});
    setAnalysis(idleAnalysis);
    const next = snapshot?.catalog.nodes.find((entry) => entry.nodeId === keys[0]);
    setSelectedNodeId(next?.nodeId ?? null);
    setCandidateId(next?.candidates[0]?.id ?? null);
    setVerification(null);
    setSending(false);
  };

  const handleSelectCandidate = (nextId) => {
    operationRef.current++;
    setCandidateId(nextId);
    setVerification(null);
    setSending(false);
  };

  const handleCancelAnalysis = () => {
    analysisOperationRef.current++;
    clientRef.current?.dispose();
    clientRef.current = null;
    setAnalysis((previous) => ({...previous, status: 'cancelled', phase: 'Análisis cancelado'}));
  };
  const handleAnalyzeElement = () => {
    if (stale || !node || sending || methodCallInProgress) {
      return;
    }
    clientRef.current?.dispose();
    const operation = ++analysisOperationRef.current;
    operationRef.current++;
    setRecommendations({});
    setCandidateId(node.candidates[0]?.id ?? null);
    setVerification(null);
    setSending(false);
    setAnalysis({status: 'running', phase: 'Analizando el elemento seleccionado', processed: 0, total: 1});
    const isCurrent = () =>
      analysisOperationRef.current === operation &&
      snapshotRef.current === snapshot &&
      currentRef.current.selectedNodeId === node.nodeId &&
      currentRef.current.sourceXML === snapshot.sourceXml &&
      currentRef.current.sourceJSON === snapshot.sourceJSON &&
      currentRef.current.currentContext === snapshot.context &&
      currentRef.current.sessionId === snapshot.sessionId &&
      !currentRef.current.refreshing;
    try {
      const client = createElementAnalysisClient({
        onUpdate(update) {
          if (!isCurrent()) {
            return;
          }
          setAnalysis(update);
          if (update.locatorContracts) {
            setLocatorContracts((previous) => ({
              ...previous,
              ...Object.fromEntries(
                update.locatorContracts.map((entry) => [JSON.stringify([entry.nodeId, entry.candidateId]), entry]),
              ),
            }));
          }
          if (update.results?.length) {
            operationRef.current++;
            setVerification(null);
            setSending(false);
            setRecommendations((previous) => ({
              ...previous,
              ...Object.fromEntries(update.results.map((result) => [result.nodeId, result])),
            }));
          }
        },
      });
      clientRef.current = client;
      client.start({
        snapshotId: snapshot.snapshotId,
        targetNodeId: node.nodeId,
        sessionId: snapshot.sessionId,
        platform: snapshot.platform,
        context: snapshot.context,
        sourceXml: snapshot.sourceXml,
        nodes: analysisNodes(snapshot.catalog),
      });
    } catch (error) {
      setAnalysis({
        status: 'error',
        phase: 'No se pudo analizar este elemento',
        error: error.message,
        processed: 0,
        total: 1,
      });
    }
  };
  const handleRefresh = async () => {
    operationRef.current++;
    analysisOperationRef.current++;
    clientRef.current?.dispose();
    clientRef.current = null;
    setRefreshing(true);
    setVerification(null);
    try {
      await applyClientMethod({methodName: 'getPageSource'});
      setRefreshVersion((value) => value + 1);
    } catch (error) {
      setCaptureError(error.message);
    } finally {
      setRefreshing(false);
    }
  };
  const handleClose = () => {
    operationRef.current++;
    analysisOperationRef.current++;
    clientRef.current?.dispose();
    clientRef.current = null;
    onClose();
  };

  const handleVerify = async (transfer) => {
    if (
      stale ||
      !node ||
      !candidate ||
      sending ||
      methodCallInProgress ||
      (transfer && candidateContract?.compatible === false)
    ) {
      return;
    }
    const operation = ++operationRef.current;
    setSending(true);
    setVerification({type: 'info', message: 'Verificando identidad y coincidencia única contra Appium…'});
    const isCurrent = () =>
      operationRef.current === operation &&
      snapshotRef.current === snapshot &&
      currentRef.current.sourceXML === snapshot.sourceXml &&
      currentRef.current.sourceJSON === snapshot.sourceJSON &&
      currentRef.current.currentContext === snapshot.context &&
      currentRef.current.sessionId === snapshot.sessionId &&
      !currentRef.current.refreshing;
    try {
      await verifyExplorerLocator(node, candidate, snapshot, {isCurrent, transfer});
      if (!isCurrent()) {
        return;
      }
      setVerification({
        type: 'success',
        nodeId: node.nodeId,
        candidateId: candidate.id,
        message: transfer
          ? 'Selector enviado para revalidación en el Recorder.'
          : 'Verificado en Appium: una coincidencia y el mismo elemento.',
      });
      if (transfer) {
        handleClose();
      }
    } catch (error) {
      if (isCurrent()) {
        setVerification({type: 'error', message: error.message});
      }
    } finally {
      if (isCurrent()) {
        setSending(false);
      }
    }
  };

  const columns = [
    {
      title: 'Estrategia y valor',
      key: 'selector',
      render: (_, entry) => {
        const contract = node ? locatorContracts[JSON.stringify([node.nodeId, entry.id])] : undefined;
        return (
          <div className={styles.candidate}>
            <Text strong>{entry.strategy}</Text>
            <Paragraph className={styles.selector} copyable={{text: entry.selector}}>
              {entry.selector}
            </Paragraph>
            <Text type="secondary">{entry.reason}</Text>
            <div className={styles.frameworkContract}>
              {contract?.compatible ? (
                <>
                  <Text code>{'TypeLocator.' + contract.locatorType}</Text>
                  <Paragraph className={styles.selector} copyable={{text: contract.locatorValue}}>
                    {contract.locatorValue}
                  </Paragraph>
                </>
              ) : (
                <Text type={contract?.compatible === false ? 'warning' : 'secondary'}>
                  {contract?.reason || 'El Recorder comprobará TypeLocator y valor al usar el selector.'}
                </Text>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Evidencia',
      key: 'evidence',
      width: 170,
      render: (_, entry) => (
        <Space orientation="vertical" size={4}>
          <Tag color={entry.unique === true ? 'cyan' : entry.unique === false ? 'orange' : 'default'}>
            {entry.unique === true ? 'Único en XML' : entry.unique === false ? 'Ambiguo en XML' : 'Unicidad pendiente'}
          </Tag>
          {verification?.type === 'success' &&
          verification.nodeId === node?.nodeId &&
          verification.candidateId === entry.id ? (
            <Tag color="green">Verificado en Appium</Tag>
          ) : (
            <Tag>Pendiente de Appium</Tag>
          )}
          {entry.origin === 'agent' && <Tag color="purple">Propuesta del agente</Tag>}
          {entry.structural && <Tag color="orange">Estructural · frágil</Tag>}
          {recommendation?.recommendedCandidateId === entry.id && <Tag color="purple">Sugerido por agente</Tag>}
        </Space>
      ),
    },
  ];

  return (
    <Modal
      open
      title="Explorar elementos de la pantalla"
      width="min(1320px, 96vw)"
      onCancel={handleClose}
      className={styles.modal}
      footer={
        <Space wrap>
          <Button onClick={handleClose}>Cerrar</Button>
          <Button disabled={stale || !candidate || sending || methodCallInProgress} onClick={() => handleVerify(false)}>
            Verificar selector
          </Button>
          <Button
            type="primary"
            loading={sending}
            disabled={stale || !candidate || sending || methodCallInProgress || candidateContract?.compatible === false}
            onClick={() => handleVerify(true)}
          >
            Usar en Recorder
          </Button>
        </Space>
      }
    >
      <div className={styles.toolbar}>
        <div>
          <Text strong>
            {platform.toUpperCase()} · {currentContext}
          </Text>
          <div>
            <Text type="secondary">
              {snapshot
                ? snapshot.catalog.nodes.length + ' nodos · captura ' + snapshot.capturedAt
                : 'Preparando captura…'}
            </Text>
          </div>
        </div>
        <Button icon={<IconRefresh size={16} />} loading={refreshing} onClick={handleRefresh}>
          Actualizar pantalla
        </Button>
      </div>
      {captureError && <Alert type="warning" showIcon title={captureError} />}
      {!snapshot && !captureError && (
        <div className={styles.loading}>
          <Spin /> Preparando árbol y locators…
        </div>
      )}
      {snapshot && (
        <>
          <div className={styles.analysis} role="status" aria-live="polite">
            <Space wrap>
              {analysisRunning && <Spin size="small" />}
              <Text>
                {analysis.phase || 'Selecciona un elemento del árbol y solicita su análisis cuando lo necesites.'}
              </Text>
              {analysis.total > 0 && (
                <Text type="secondary">
                  {analysis.processed} / {analysis.total} elemento
                </Text>
              )}
              {analysis.model && <Text type="secondary">{analysis.model}</Text>}
            </Space>
            {analysisRunning ? (
              <Button size="small" onClick={handleCancelAnalysis}>
                Cancelar análisis
              </Button>
            ) : (
              <Tooltip title="El agente analiza únicamente el nodo seleccionado y usa el XML completo como contexto. Puedes elegir textos, campos, botones o cualquier otro nodo.">
                <Button
                  type="primary"
                  disabled={stale || !node || sending || methodCallInProgress}
                  onClick={handleAnalyzeElement}
                >
                  Analizar este elemento
                </Button>
              </Tooltip>
            )}
          </div>
          {analysis.status === 'error' && (
            <Alert
              type="warning"
              showIcon
              title="El árbol y los locators siguen disponibles"
              description={
                analysis.error || 'El agente no pudo completar el análisis. Puedes continuar con la evidencia local.'
              }
            />
          )}
          <div className={styles.panels}>
            <section className={styles.treePanel} aria-label="Árbol completo de elementos">
              <Input.Search
                aria-label="Buscar elemento por texto, identificador o tipo"
                placeholder="Buscar texto, identificador o tipo"
                allowClear
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Select aria-label="Filtrar elementos" options={filters} value={filter} onChange={setFilter} />
              <Text type="secondary">{tree.matchingCount} coincidencias · se conservan los nodos padre</Text>
              <Tree
                virtual
                height={440}
                treeData={tree.treeData}
                selectedKeys={selectedNodeId === null ? [] : [selectedNodeId]}
                expandedKeys={query || filter !== 'all' ? tree.includedKeys : expandedKeys}
                onExpand={setExpandedKeys}
                onSelect={handleSelectNode}
                showLine
                blockNode
              />
            </section>
            <section className={styles.details} aria-label="Detalle del elemento">
              {!node ? (
                <Empty description="Selecciona un nodo para revisar sus identificadores y locators" />
              ) : (
                <>
                  <div>
                    <Text strong>{node.label || node.tag}</Text> <Tag>{node.tag}</Tag>
                  </div>
                  {snapshot.screenshot && (
                    <div className={styles.preview}>
                      <img
                        src={'data:image/png;base64,' + snapshot.screenshot}
                        alt="Captura de la pantalla analizada"
                      />
                      {previewRect && <span className={styles.previewRect} style={previewRect} />}
                    </div>
                  )}
                  {recommendation && (
                    <Alert
                      type="info"
                      showIcon
                      title={'Nombre sugerido: ' + recommendation.suggestedName}
                      description={recommendation.reason}
                    />
                  )}
                  {recommendation?.warnings?.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      title="Observaciones del análisis"
                      description={
                        <ul>
                          {[...new Set(recommendation.warnings)].map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      }
                    />
                  )}
                  <Text type="secondary">
                    Las propuestas se comprueban con el XML. Verifica el selector en Appium antes de usarlo; «Usar en
                    Recorder» también verifica su identidad.
                  </Text>
                  <details className={styles.attributes}>
                    <summary>Atributos del XML ({Object.keys(node.attributes).length})</summary>
                    <dl>
                      {Object.entries(node.attributes).map(([name, value]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd>{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={candidates}
                    columns={columns}
                    scroll={{y: 350}}
                    locale={{emptyText: 'No hay locators compatibles para este nodo'}}
                    rowSelection={{
                      type: 'radio',
                      selectedRowKeys: candidateId === null ? [] : [candidateId],
                      onChange: (keys) => handleSelectCandidate(keys[0]),
                    }}
                    onRow={(entry) => ({onClick: () => handleSelectCandidate(entry.id)})}
                  />
                </>
              )}
            </section>
          </div>
          {verification && <Alert showIcon type={verification.type} title={verification.message} />}
        </>
      )}
    </Modal>
  );
}

export default function ElementExplorer(props) {
  const [open, setOpen] = useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);
  return (
    <>
      <Button id="btnExploreElements" icon={<IconBinaryTree size={16} />} onClick={handleOpen}>
        Explorar elementos
      </Button>
      {open && <ElementExplorerModal {...props} onClose={handleClose} />}
    </>
  );
}
