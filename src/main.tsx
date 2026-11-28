import { render } from 'preact';
import { App } from './app/App';
import './styles/global.css';
import './styles/studioTheme.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Folio Studio could not find its application root.');
}

render(<App />, root);

// Defer WASM spatial kernel & Compute Worker warmup until after first paint.
const bootKernelsDeferred = () => {
  void import('./core/kernels').then((mod) => mod.bootMonsterComputeKernels());
};
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback(bootKernelsDeferred, { timeout: 600 });
} else {
  queueMicrotask(bootKernelsDeferred);
}
