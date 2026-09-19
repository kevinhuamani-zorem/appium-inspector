/** Keep matching nodes and their ancestors; no cap or silent pruning of the XML tree. */
export function explorerTree(catalog, query = '', filter = 'all') {
  const nodes = catalog?.nodes || [];
  const lookup = new Map(nodes.map((node) => [node.nodeId, node]));
  const term = query.trim().toLocaleLowerCase();
  const matches = nodes.filter((node) => {
    if (filter === 'visible' && !node.visible) {
      return false;
    }
    if (filter === 'interactive' && !node.interactive) {
      return false;
    }
    if (filter === 'ambiguous' && !node.candidates.some((candidate) => candidate.unique === false)) {
      return false;
    }
    return (
      !term ||
      [node.label, node.tag, ...Object.values(node.attributes)].some((value) =>
        String(value).toLocaleLowerCase().includes(term),
      )
    );
  });
  const included = new Set();
  for (const node of matches) {
    let current = node;
    while (current && !included.has(current.nodeId)) {
      included.add(current.nodeId);
      current = lookup.get(current.parentId);
    }
  }
  const records = new Map(
    nodes
      .filter((node) => included.has(node.nodeId))
      .map((node) => [node.nodeId, {key: node.nodeId, title: node.label || node.tag, children: []}]),
  );
  const roots = [];
  for (const node of nodes) {
    const entry = records.get(node.nodeId);
    if (!entry) {
      continue;
    }
    const parent = node.parentId === null ? undefined : records.get(node.parentId);
    if (parent) {
      parent.children.push(entry);
    } else {
      roots.push(entry);
    }
  }
  return {treeData: roots, matchingCount: matches.length, includedKeys: [...included]};
}

export function analysisNodes(catalog) {
  return catalog.nodes.map(({nodeId, parentId, tag, attributes, candidates}) => ({
    nodeId,
    parentId,
    tag,
    attributes,
    candidates: candidates.map(({id, strategy, selector, reason, unique, structural}) => ({
      id,
      strategy,
      selector,
      reason,
      unique,
      structural: Boolean(structural),
    })),
  }));
}

/** Overlay in viewport percentages; absent/offscreen geometry never invents a rectangle. */
export function nodePreviewRect(node, viewport) {
  if (!node || !(viewport?.width > 0) || !(viewport?.height > 0)) {
    return null;
  }
  const attributes = node.attributes;
  const bounds = attributes.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  let x, y, width, height;
  if (bounds) {
    x = Number(bounds[1]);
    y = Number(bounds[2]);
    width = Number(bounds[3]) - x;
    height = Number(bounds[4]) - y;
  } else {
    x = Number(attributes.x);
    y = Number(attributes.y);
    width = Number(attributes.width);
    height = Number(attributes.height);
  }
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(viewport.width, x + width);
  const bottom = Math.min(viewport.height, y + height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    left: (left / viewport.width) * 100 + '%',
    top: (top / viewport.height) * 100 + '%',
    width: ((right - left) / viewport.width) * 100 + '%',
    height: ((bottom - top) / viewport.height) * 100 + '%',
  };
}

/** Keep local candidates first; an agent proposal never replaces recorded evidence. */
export function elementCandidates(node, proposals = []) {
  const candidates = (node?.candidates || []).map((candidate) => ({...candidate, origin: 'local'}));
  const ids = new Set(candidates.map(({id}) => id));
  const pairs = new Set(candidates.map(({strategy, selector}) => JSON.stringify([strategy, selector])));
  for (const proposal of proposals) {
    const pair = JSON.stringify([proposal.strategy, proposal.selector]);
    if (ids.has(proposal.id) || pairs.has(pair)) {
      continue;
    }
    ids.add(proposal.id);
    pairs.add(pair);
    candidates.push({...proposal, origin: 'agent', stability: proposal.structural ? 'structural' : 'contextual'});
  }
  return candidates;
}

/** The Inspector path may be empty: it identifies the XML document root. */
export function initialExplorerSelection(catalog, path) {
  const node = typeof path === 'string' ? catalog.nodes.find((entry) => entry.nodeId === path) : undefined;
  const expanded = new Set(catalog.roots);
  const lookup = new Map(catalog.nodes.map((entry) => [entry.nodeId, entry]));
  let current = node;
  while (current?.parentId !== null && current?.parentId !== undefined) {
    expanded.add(current.parentId);
    current = lookup.get(current.parentId);
  }
  return {nodeId: node?.nodeId ?? null, candidateId: node?.candidates[0]?.id ?? null, expandedKeys: [...expanded]};
}
