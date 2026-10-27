import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/index.css';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
