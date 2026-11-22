import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ShooterPlayground } from './components/ShooterPlayground';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Không tìm thấy phần tử root.');
// /?shooter=<level> opens the shooter playground instead of the app (no API call).
const shooter = new URLSearchParams(window.location.search).get('shooter');
createRoot(root).render(<StrictMode>{shooter === null ? <App/> : <ShooterPlayground name={shooter}/>}</StrictMode>);
