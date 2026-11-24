import { render } from 'preact';
import { App } from './app/App';
import { bootMonsterComputeKernels } from './core/kernels';
import './styles/global.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Folio Studio could not find its application root.');
}

void bootMonsterComputeKernels();

render(<App />, root);
