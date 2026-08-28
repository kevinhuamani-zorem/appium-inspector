import {Alert, Button, Input, Select, Space} from 'antd';
import {useEffect, useRef, useState} from 'react';

import styles from './SelectedElement.module.css';

export const isValidRecorderSelection = (selectedElement, strategy, selector) =>
  Boolean(selectedElement?.path && strategy?.trim() && selector?.trim());

export const acquireRecorderSend = (isSendingRef) => {
  if (isSendingRef.current) {
    return null;
  }
  isSendingRef.current = true;
  return () => {
    isSendingRef.current = false;
  };
};

export const confirmRecorderSelection = async ({
  isSendingRef,
  selectedElement,
  strategy,
  selector,
  send,
  setIsSending,
  setFeedback,
}) => {
  if (!isValidRecorderSelection(selectedElement, strategy, selector)) {
    return false;
  }
  const releaseSend = acquireRecorderSend(isSendingRef);
  if (!releaseSend) {
    return false;
  }

  setIsSending(true);
  setFeedback(null);
  try {
    await send(strategy, selector);
    setFeedback({type: 'success', title: 'Elemento enviado al Recorder'});
    return true;
  } catch (error) {
    setFeedback({type: 'error', title: error.message});
    return false;
  } finally {
    releaseSend();
    setIsSending(false);
  }
};

const EmbeddedRecorderSelection = ({
  selectedElement,
  selectedElementPath,
  useElementInRecorder: confirmElementInRecorder,
}) => {
  const initialLocator = selectedElement.strategyMap[0] || ['', ''];
  const [strategy, setStrategy] = useState(initialLocator[0]);
  const [selector, setSelector] = useState(initialLocator[1]);
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const isSendingRef = useRef(false);

  useEffect(() => {
    const [nextStrategy, nextSelector] = selectedElement.strategyMap[0] || ['', ''];
    setStrategy(nextStrategy);
    setSelector(nextSelector);
    setFeedback(null);
  }, [selectedElementPath, selectedElement.strategyMap]);

  const onStrategyChange = (nextStrategy) => {
    setStrategy(nextStrategy);
    setSelector(selectedElement.strategyMap.find(([candidate]) => candidate === nextStrategy)?.[1] || '');
    setFeedback(null);
  };

  const onUse = () =>
    confirmRecorderSelection({
      isSendingRef,
      selectedElement,
      strategy,
      selector,
      send: confirmElementInRecorder,
      setIsSending,
      setFeedback,
    });

  return (
    <Space className={styles.recorderSelection} orientation="vertical" size="small">
      <Space.Compact className={styles.recorderLocatorControls}>
        <Select
          aria-label="Estrategia del locator"
          value={strategy}
          options={selectedElement.strategyMap.map(([value]) => ({label: value, value}))}
          onChange={onStrategyChange}
        />
        <Input
          aria-label="Valor del locator"
          value={selector}
          onChange={(event) => {
            setSelector(event.target.value);
            setFeedback(null);
          }}
        />
        <Button
          id="btnUseInRecorder"
          type="primary"
          loading={isSending}
          disabled={isSending || !isValidRecorderSelection(selectedElement, strategy, selector)}
          onClick={onUse}
        >
          Usar en Recorder
        </Button>
      </Space.Compact>
      {feedback && <Alert showIcon type={feedback.type} title={feedback.title} />}
    </Space>
  );
};

export default EmbeddedRecorderSelection;
