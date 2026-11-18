import { render } from 'preact';
import { App } from './app/App';
import './styles/global.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Folio Studio could not find its application root.');
}

render(<App />, root);
