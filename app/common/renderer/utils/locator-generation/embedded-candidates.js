import {select as xpathSelect} from 'xpath';

import {DRIVERS} from '../../constants/common.js';
import {LOCATOR_STRATEGIES as STRATEGIES} from '../../constants/session-inspector.js';
import {findDOMNodeByPath, xmlToDOM} from '../source-parsing.js';
import {getOptimalXPath} from './xpath.js';

const IOS_EDITABLE_TYPES = new Set([
  'XCUIElementTypeSearchField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeTextField',
  'XCUIElementTypeTextView',
]);
const IOS_CONTAINER_TYPES = new Set([
  'XCUIElementTypeCell',
  'XCUIElementTypeCollectionView',
  'XCUIElementTypeOther',
  'XCUIElementTypeScrollView',
  'XCUIElementTypeTable',
]);

export const escapeJavaString = (value) =>
  String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('\f', '\\f')
    .replaceAll('\b', '\\b');

export const escapePredicateString = (value) => String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");

export const escapeClassChainString = (value) => escapePredicateString(value).replaceAll('`', '\\`');

export const toXPathLiteral = (value) => {
  const stringValue = String(value);
  if (!stringValue.includes("'")) {
    return `'${stringValue}'`;
  }
  if (!stringValue.includes('"')) {
    return `"${stringValue}"`;
  }
  return `concat(${stringValue
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`;
};

const elementNodes = (document) => Array.from(document?.getElementsByTagName?.('*') || []);
const hasValue = (value) => typeof value === 'string' && value.length > 0;
const predicateLiteral = (value) => `'${escapePredicateString(value)}'`;
const classChainLiteral = (value) => `'${escapeClassChainString(value)}'`;

const matchesAttributes = (node, attributes) =>
  Object.entries(attributes).every(([name, value]) => node.getAttribute(name) === value);

const attributeUniqueness = (document, attributes, tagName) => {
  const count = elementNodes(document).filter(
    (node) => (!tagName || node.tagName === tagName) && matchesAttributes(node, attributes),
  ).length;
  return count === 0 ? null : count === 1;
};

const containsUniqueness = (document, attribute, value, tagName) => {
  const count = elementNodes(document).filter(
    (node) =>
      (!tagName || node.tagName === tagName) &&
      hasValue(node.getAttribute(attribute)) &&
      node.getAttribute(attribute).includes(value),
  ).length;
  return count === 0 ? null : count === 1;
};

const stableHash = (value) => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const xpathUniqueness = (document, node, selector) => {
  try {
    const matches = xpathSelect(selector, document);
    return matches.includes(node) ? matches.length === 1 : null;
  } catch {
    return null;
  }
};

const makeCandidate = ({label, strategy, selector, priority, unique, source, reason, structural = false}) => ({
  id: `${strategy.replaceAll(/[^a-z0-9]+/gi, '-')}-${stableHash(`${strategy}\0${selector}`)}`,
  key: `${strategy}:${stableHash(`${strategy}\0${selector}`)}`,
  label,
  find: label,
  strategy,
  selector,
  priority,
  unique,
  uniqueness: unique === true ? 'unique' : unique === false ? 'non-unique' : 'unknown',
  source,
  reason,
  structural,
});

const dedupeAndRank = (candidates) => {
  const candidatesByLocator = new Map();
  for (const candidate of candidates.filter(({selector}) => hasValue(selector))) {
    const identity = `${candidate.strategy}\0${candidate.selector}`;
    const current = candidatesByLocator.get(identity);
    if (!current || candidate.priority < current.priority) {
      candidatesByLocator.set(identity, candidate);
    }
  }
  return [...candidatesByLocator.values()].sort(
    (left, right) =>
      Number(left.structural) - Number(right.structural) ||
      left.priority - right.priority ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id),
  );
};

const androidDirectIdIsSafe = (value) =>
  /^[A-Za-z_][\w.]*$/.test(value) || /^[A-Za-z_][\w.]*:id\/[A-Za-z_][\w.]*$/.test(value);

const regexQuoted = (value) => `\\Q${String(value).replaceAll('\\E', '\\E\\\\E\\Q')}\\E`;
const uiSelector = (method, value) => `new UiSelector().${method}("${escapeJavaString(value)}")`;
const xpathExact = (tagName, attribute, value) => `//${tagName || '*'}[@${attribute}=${toXPathLiteral(value)}]`;
const xpathContains = (tagName, attribute, value) =>
  `//${tagName || '*'}[contains(@${attribute}, ${toXPathLiteral(value)})]`;
const xpathAttributes = (tagName, attributes) =>
  `//${tagName || '*'}[${Object.entries(attributes)
    .map(([attribute, value]) => `@${attribute}=${toXPathLiteral(value)}`)
    .join(' and ')}]`;

const addAndroidAttributeCandidates = (candidates, document, tagName, attribute, value, basePriority) => {
  const unique = attributeUniqueness(document, {[attribute]: value});
  candidates.push(
    makeCandidate({
      label: `XPath ${attribute} exact`,
      strategy: STRATEGIES.XPATH,
      selector: xpathExact(tagName, attribute, value),
      priority: basePriority,
      unique,
      source: attribute,
      reason: `Exact ${attribute} attribute`,
    }),
    makeCandidate({
      label: `XPath ${attribute} contains`,
      strategy: STRATEGIES.XPATH,
      selector: xpathContains(tagName, attribute, value),
      priority: basePriority + 4,
      unique: containsUniqueness(document, attribute, value, tagName),
      source: attribute,
      reason: `Partial ${attribute} attribute`,
    }),
  );
};

const generateAndroidCandidates = (document, node) => {
  const candidates = [];
  const tagName = node.tagName;
  const resourceId = node.getAttribute('resource-id') || node.getAttribute('id');
  const resourceAttribute = node.hasAttribute('resource-id') ? 'resource-id' : 'id';
  const contentDescription = node.getAttribute('content-desc');
  const text = node.getAttribute('text');
  const className = node.getAttribute('class') || tagName;

  if (hasValue(resourceId)) {
    const unique = attributeUniqueness(document, {[resourceAttribute]: resourceId});
    if (androidDirectIdIsSafe(resourceId)) {
      candidates.push(
        makeCandidate({
          label: 'ID (resource-id)',
          strategy: STRATEGIES.ID,
          selector: resourceId,
          priority: unique ? 10 : 60,
          unique,
          source: resourceAttribute,
          reason: 'Direct Android resource identifier',
        }),
      );
    }
    candidates.push(
      makeCandidate({
        label: 'UIAutomator resourceId',
        strategy: STRATEGIES.UIAUTOMATOR,
        selector: uiSelector('resourceId', resourceId),
        priority: 30,
        unique,
        source: resourceAttribute,
        reason: 'Exact Android resource identifier',
      }),
      makeCandidate({
        label: 'UIAutomator resourceIdMatches',
        strategy: STRATEGIES.UIAUTOMATOR,
        selector: uiSelector('resourceIdMatches', regexQuoted(resourceId)),
        priority: 34,
        unique,
        source: resourceAttribute,
        reason: 'Regex-quoted Android resource identifier',
      }),
    );
    addAndroidAttributeCandidates(candidates, document, tagName, resourceAttribute, resourceId, 70);
  }

  if (hasValue(contentDescription)) {
    const unique = attributeUniqueness(document, {'content-desc': contentDescription});
    candidates.push(
      makeCandidate({
        label: 'Accessibility ID (content-desc)',
        strategy: STRATEGIES.ACCESSIBILITY_ID,
        selector: contentDescription,
        priority: unique ? 20 : 62,
        unique,
        source: 'content-desc',
        reason: 'Android accessibility description',
      }),
      makeCandidate({
        label: 'UIAutomator description',
        strategy: STRATEGIES.UIAUTOMATOR,
        selector: uiSelector('description', contentDescription),
        priority: 38,
        unique,
        source: 'content-desc',
        reason: 'Exact Android accessibility description',
      }),
    );
    addAndroidAttributeCandidates(candidates, document, tagName, 'content-desc', contentDescription, 74);
  }

  if (hasValue(text)) {
    const unique = attributeUniqueness(document, {text});
    candidates.push(
      makeCandidate({
        label: 'UIAutomator text',
        strategy: STRATEGIES.UIAUTOMATOR,
        selector: uiSelector('text', text),
        priority: 42,
        unique,
        source: 'text',
        reason: 'Exact visible text',
      }),
      makeCandidate({
        label: 'UIAutomator textContains',
        strategy: STRATEGIES.UIAUTOMATOR,
        selector: uiSelector('textContains', text),
        priority: 46,
        unique: containsUniqueness(document, 'text', text),
        source: 'text',
        reason: 'Partial visible text',
      }),
    );
    addAndroidAttributeCandidates(candidates, document, tagName, 'text', text, 78);
  }

  if (hasValue(className)) {
    const classAttribute = node.hasAttribute('class') ? 'class' : null;
    const classXPath = classAttribute ? xpathExact('*', classAttribute, className) : `//${className}`;
    const classUnique = classAttribute
      ? attributeUniqueness(document, {class: className})
      : elementNodes(document).filter(({tagName: candidateTag}) => candidateTag === className).length === 1;
    candidates.push(
      makeCandidate({
        label: 'Class name',
        strategy: STRATEGIES.CLASS_NAME,
        selector: className,
        priority: 55,
        unique: classUnique,
        source: classAttribute || 'tagName',
        reason: 'Android widget class',
      }),
      makeCandidate({
        label: 'UIAutomator className',
        strategy: STRATEGIES.UIAUTOMATOR,
        selector: uiSelector('className', className),
        priority: 58,
        unique: classUnique,
        source: classAttribute || 'tagName',
        reason: 'Android widget class',
      }),
      makeCandidate({
        label: 'XPath class fallback',
        strategy: STRATEGIES.XPATH,
        selector: classXPath,
        priority: 92,
        unique: classUnique,
        source: classAttribute || 'tagName',
        reason: 'Widget class fallback',
      }),
    );

    for (const [attribute, value] of [
      [resourceAttribute, resourceId],
      ['text', text],
      ['content-desc', contentDescription],
    ]) {
      if (!hasValue(value) || attributeUniqueness(document, {[attribute]: value}) !== false) {
        continue;
      }
      const combinedAttributes = classAttribute ? {class: className, [attribute]: value} : {[attribute]: value};
      const combinedUnique = attributeUniqueness(document, combinedAttributes, classAttribute ? undefined : tagName);
      const combinedXPath = xpathAttributes(classAttribute ? '*' : tagName, combinedAttributes);
      const chainedSelector =
        uiSelector('className', className) +
        `.${attribute === resourceAttribute ? 'resourceId' : attribute === 'content-desc' ? 'description' : 'text'}("${escapeJavaString(value)}")`;
      candidates.push(
        makeCandidate({
          label: `UIAutomator class + ${attribute}`,
          strategy: STRATEGIES.UIAUTOMATOR,
          selector: chainedSelector,
          priority: 50,
          unique: combinedUnique,
          source: `${classAttribute || 'tagName'},${attribute}`,
          reason: `Disambiguates non-unique ${attribute} with widget class`,
        }),
        makeCandidate({
          label: `XPath class + ${attribute}`,
          strategy: STRATEGIES.XPATH,
          selector: combinedXPath,
          priority: 68,
          unique: xpathUniqueness(document, node, combinedXPath),
          source: `${classAttribute || 'tagName'},${attribute}`,
          reason: `Disambiguates non-unique ${attribute} with widget class`,
        }),
      );
    }
  }

  const structuralXPath = getOptimalXPath(document, node);
  if (structuralXPath) {
    candidates.push(
      makeCandidate({
        label: 'XPath structural fallback',
        strategy: STRATEGIES.XPATH,
        selector: structuralXPath,
        priority: 1000,
        unique: xpathUniqueness(document, node, structuralXPath),
        source: 'hierarchy',
        reason: 'Structural source-tree fallback',
        structural: true,
      }),
    );
  }
  return dedupeAndRank(candidates);
};

const addIosAttributeCandidates = (candidates, document, type, attribute, value, basePriority, contextReason) => {
  const unique = attributeUniqueness(document, {[attribute]: value});
  const typeAndAttributeUnique = attributeUniqueness(document, {type, [attribute]: value});
  candidates.push(
    makeCandidate({
      label: `Predicate ${attribute} exact`,
      strategy: STRATEGIES.PREDICATE,
      selector: `${attribute} == ${predicateLiteral(value)}`,
      priority: basePriority,
      unique,
      source: attribute,
      reason: contextReason || `Exact iOS ${attribute}`,
    }),
    makeCandidate({
      label: `Predicate ${attribute} contains`,
      strategy: STRATEGIES.PREDICATE,
      selector: `${attribute} CONTAINS ${predicateLiteral(value)}`,
      priority: basePriority + 5,
      unique: containsUniqueness(document, attribute, value),
      source: attribute,
      reason: `Partial iOS ${attribute}`,
    }),
    makeCandidate({
      label: `Class chain type + ${attribute}`,
      strategy: STRATEGIES.CLASS_CHAIN,
      selector: `**/${type}[\`${attribute} == ${classChainLiteral(value)}\`]`,
      priority: basePriority + 12,
      unique: typeAndAttributeUnique,
      source: `type,${attribute}`,
      reason: `iOS type scoped by ${attribute}`,
    }),
    makeCandidate({
      label: `XPath ${attribute}`,
      strategy: STRATEGIES.XPATH,
      selector: xpathExact(type, attribute, value),
      priority: basePriority + 50,
      unique: typeAndAttributeUnique,
      source: `type,${attribute}`,
      reason: `Exact iOS ${attribute}`,
    }),
  );
};

const generateIosCandidates = (document, node) => {
  const candidates = [];
  const type = node.getAttribute('type') || node.tagName;
  const name = node.getAttribute('name');
  const label = node.getAttribute('label');
  const value = node.getAttribute('value');
  const accessibilityValue = name || label;

  if (hasValue(accessibilityValue)) {
    const source = hasValue(name) ? 'name' : 'label';
    candidates.push(
      makeCandidate({
        label: `Accessibility ID (${source})`,
        strategy: STRATEGIES.ACCESSIBILITY_ID,
        selector: accessibilityValue,
        priority: attributeUniqueness(document, {[source]: accessibilityValue}) ? 10 : 60,
        unique: attributeUniqueness(document, {[source]: accessibilityValue}),
        source,
        reason: 'iOS accessibility identifier',
      }),
    );
  }

  for (const [attribute, attributeValue, priority] of [
    ['name', name, 25],
    ['label', label, 35],
    ['value', value, 45],
  ]) {
    if (hasValue(attributeValue)) {
      const contextualReason =
        IOS_EDITABLE_TYPES.has(type) && attribute === 'value'
          ? 'Editable field value'
          : IOS_CONTAINER_TYPES.has(type)
            ? 'Container-scoped attribute'
            : undefined;
      addIosAttributeCandidates(candidates, document, type, attribute, attributeValue, priority, contextualReason);
    }
  }

  if (hasValue(type)) {
    const typeUnique = attributeUniqueness(document, {type});
    candidates.push(
      makeCandidate({
        label: 'Class name (type)',
        strategy: STRATEGIES.CLASS_NAME,
        selector: type,
        priority: 65,
        unique: typeUnique,
        source: 'type',
        reason: IOS_EDITABLE_TYPES.has(type)
          ? 'Editable control type'
          : IOS_CONTAINER_TYPES.has(type)
            ? 'Container type'
            : 'iOS element type',
      }),
      makeCandidate({
        label: 'Predicate type',
        strategy: STRATEGIES.PREDICATE,
        selector: `type == ${predicateLiteral(type)}`,
        priority: 70,
        unique: typeUnique,
        source: 'type',
        reason: 'Exact iOS element type',
      }),
      makeCandidate({
        label: 'XPath type',
        strategy: STRATEGIES.XPATH,
        selector: `//${type}`,
        priority: 95,
        unique: typeUnique,
        source: 'type',
        reason: 'iOS type fallback',
      }),
    );
  }

  const structuralXPath = getOptimalXPath(document, node);
  if (structuralXPath) {
    candidates.push(
      makeCandidate({
        label: 'XPath structural fallback',
        strategy: STRATEGIES.XPATH,
        selector: structuralXPath,
        priority: 1000,
        unique: xpathUniqueness(document, node, structuralXPath),
        source: 'hierarchy',
        reason: 'Structural source-tree fallback',
        structural: true,
      }),
    );
  }
  return dedupeAndRank(candidates);
};

/**
 * Build a rich, repeatable candidate list for the embedded recorder UI without
 * changing the upstream one-selector-per-strategy recommendation contract.
 */
export function getEmbeddedLocatorCandidates(selectedElement, sourceXML, isNative, automationName) {
  if (!isNative || !selectedElement?.path || !sourceXML) {
    return [];
  }
  const document = xmlToDOM(sourceXML);
  const node = findDOMNodeByPath(selectedElement.path, document);
  if (!node) {
    return [];
  }
  switch (automationName) {
    case DRIVERS.UIAUTOMATOR2:
      return generateAndroidCandidates(document, node);
    case DRIVERS.XCUITEST:
    case DRIVERS.MAC2:
      return generateIosCandidates(document, node);
    default:
      return [];
  }
}
