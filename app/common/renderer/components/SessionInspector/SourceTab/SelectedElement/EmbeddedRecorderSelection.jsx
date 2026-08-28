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
  locatorCandidates,
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
  setFeedback({type: 'info', title: 'Verificando locators con la sesión activa de Appium…'});
  try {
    const payload = await send(strategy, selector, locatorCandidates);
    const alternativeCount = Math.max(0, payload.candidates.length - 1);
    setFeedback({
      type: 'success',
      title: `Elemento enviado al Recorder con ${alternativeCount} alternativa${alternativeCount === 1 ? '' : 's'} verificada${alternativeCount === 1 ? '' : 's'}`,
    });
    return true;
  } catch (error) {
    setFeedback({type: 'error', title: error.message});
    return false;
  } finally {
    releaseSend();
    setIsSending(false);
  }
};

export const selectionForCandidate = (candidate) => ({
  strategy: candidate?.strategy || '',
  selector: candidate?.selector || '',
});

export const selectionForStrategy = (candidates, strategy) =>
  selectionForCandidate(candidates.find((candidate) => candidate.strategy === strategy));

export const applyRecorderSelection = (selection, {setStrategy, setSelector, setFeedback}) => {
  setStrategy(selection.strategy);
  setSelector(selection.selector);
  setFeedback(null);
};

export const applyRecorderSelectorEdit = (selector, {setSelector, setFeedback}) => {
  setSelector(selector);
  setFeedback(null);
};

export const useRecorderLocatorSelection = (candidates, selectedElementPath) => {
  const initialSelection = selectionForCandidate(candidates[0]);
  const [strategy, setStrategy] = useState(initialSelection.strategy);
  const [selector, setSelector] = useState(initialSelection.selector);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    const nextSelection = selectionForCandidate(candidates[0]);
    applyRecorderSelection(nextSelection, {setStrategy, setSelector, setFeedback});
  }, [candidates, selectedElementPath]);

  const selectCandidate = (candidate) => {
    applyRecorderSelection(selectionForCandidate(candidate), {setStrategy, setSelector, setFeedback});
  };
  const selectStrategy = (nextStrategy) => {
    const nextSelection = selectionForStrategy(candidates, nextStrategy);
    applyRecorderSelection({...nextSelection, strategy: nextStrategy}, {setStrategy, setSelector, setFeedback});
  };
  const editSelector = (nextSelector) => {
    applyRecorderSelectorEdit(nextSelector, {setSelector, setFeedback});
  };
  const activeCandidate = candidates.find(
    (candidate) => candidate.strategy === strategy && candidate.selector === selector,
  );

  return {
    strategy,
    selector,
    feedback,
    setFeedback,
    selectCandidate,
    selectStrategy,
    editSelector,
    activeCandidateId: activeCandidate?.id,
  };
};

const EmbeddedRecorderSelection = ({
  selectedElement,
  useElementInRecorder: confirmElementInRecorder,
  locatorSelection,
  locatorCandidates,
}) => {
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  const {strategy, selector, feedback, setFeedback, selectStrategy, editSelector} = locatorSelection;
  const strategyOptions = [...new Set(locatorCandidates.map((candidate) => candidate.strategy))].map((value) => ({
    label: value,
    value,
  }));

  const onUse = () =>
    confirmRecorderSelection({
      isSendingRef,
      selectedElement,
      strategy,
      selector,
      locatorCandidates,
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
          options={strategyOptions}
          onChange={selectStrategy}
        />
        <Input
          aria-label="Valor del locator"
          value={selector}
          onChange={(event) => {
            editSelector(event.target.value);
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
