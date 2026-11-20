// Keeps a chart in step with the width of its box. Chart.js already listens to its parent, but a box inside a flex or grid
// item can change width without the window resizing (panel docking, sidebar collapse), so the box is watched directly.
// `getChart()` returns the current instance (charts are replaced when the metric changes). Returns the teardown function.
const nextFrame = fn => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));

export function watchResize(box, getChart, { schedule = nextFrame } = {}) {
  const Observer = globalThis.ResizeObserver;
  if (typeof Observer !== 'function') return () => {};
  let stopped = false;
  let last = null;
  let observer = null;
  try {
    observer = new Observer(entries => {
      const width = entries?.[0]?.contentRect?.width;
      if (stopped || width === last) return;
      last = width;
      schedule(() => { if (!stopped) { try { getChart()?.resize?.(); } catch { /* the chart is being replaced */ } } });
    });
    observer.observe(box);
  } catch { return () => {}; }
  return () => { stopped = true; try { observer.disconnect(); } catch { /* already gone */ } };
}
