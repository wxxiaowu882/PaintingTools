/**
 * Dijkstra seam finding for image quilting (MIT, from patorjk/image-quilter).
 */

export function dijkstra(graph, start) {
  const distances = {};
  const visited = new Set();
  let nodes = Object.keys(graph);
  for (const node of nodes) {
    distances[node] = { name: node, dist: Infinity };
  }
  distances[start].dist = 0;
  while (nodes.length) {
    nodes.sort((a, b) => distances[a].dist - distances[b].dist);
    const closestNode = nodes.shift();
    if (distances[closestNode].dist === Infinity) break;
    visited.add(closestNode);
    for (const neighbor in graph[closestNode]) {
      if (!visited.has(neighbor)) {
        const newDistance = distances[closestNode].dist + graph[closestNode][neighbor];
        if (newDistance < distances[neighbor].dist) {
          distances[neighbor] = { dist: newDistance, prev: closestNode };
        }
      }
    }
  }
  return distances;
}

export function getGraphPath(endPoint, distances) {
  const path = [];
  let prev = distances[endPoint]?.prev;
  path.push(endPoint);
  while (prev && distances[prev]?.prev) {
    path.push(prev);
    prev = distances[prev].prev;
  }
  if (prev && prev !== endPoint) path.push(prev);
  return path;
}

export function cutGraph(graph, path) {
  const newGraph = structuredClone(graph);
  let prev;
  for (const nodeToRemove of path) {
    delete newGraph[nodeToRemove];
    for (const prop of Object.keys(newGraph)) {
      delete newGraph[prop][nodeToRemove];
    }
    if (prev) {
      const prevNums = prev.split("_");
      const curNums = nodeToRemove.split("_");
      if (prevNums[0] !== curNums[0] && prevNums[1] !== curNums[1]) {
        const adj1 = `${prevNums[0]}_${curNums[1]}`;
        const adj2 = `${curNums[0]}_${prevNums[1]}`;
        if (newGraph[adj1]) delete newGraph[adj1][adj2];
        if (newGraph[adj2]) delete newGraph[adj2][adj1];
      }
    }
    prev = nodeToRemove;
  }
  return newGraph;
}

export function getOriginalSegmentBorder(cutType, startPoint, endPoint, middle) {
  const startCoords = startPoint.split("_").map((n) => parseInt(n, 10));
  const endCoords = endPoint.split("_").map((n) => parseInt(n, 10));
  const segment = new Set();
  const verticalEdge = (startRow, endRow, col) => {
    for (let ii = startRow; ii <= endRow; ii++) segment.add(`${ii}_${col}`);
  };
  const horizontalEdge = (startCol, endCol, row) => {
    for (let ii = startCol; ii <= endCol; ii++) segment.add(`${row}_${ii}`);
  };
  if (cutType === "h") {
    horizontalEdge(0, startCoords[1] - 1, 0);
    verticalEdge(0, endCoords[0], 0);
    horizontalEdge(0, endCoords[1] - 1, 0);
  } else if (cutType === "v") {
    verticalEdge(0, startCoords[0], 0);
    horizontalEdge(0, endCoords[1] - 1, 0);
    verticalEdge(0, endCoords[0], 0);
  } else if (cutType === "b") {
    horizontalEdge(0, startCoords[1] - 1, startCoords[0]);
    verticalEdge(0, startCoords[0], 0);
    horizontalEdge(0, endCoords[1], 0);
    verticalEdge(0, endCoords[0] - 1, endCoords[1]);
  }
  return [...segment];
}

export function getOriginalSegmentNodes(dijstraGraph, nodes) {
  const infinityNodes = [];
  const finiteNodes = [];
  for (const key of Object.keys(dijstraGraph)) {
    if (isFinite(dijstraGraph[key].dist)) finiteNodes.push(key);
    else infinityNodes.push(key);
  }
  for (const node of nodes) {
    if (dijstraGraph[node]) {
      return isFinite(dijstraGraph[node].dist) ? finiteNodes : infinityNodes;
    }
  }
  return [];
}
