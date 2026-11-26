import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ShooterPlayground } from './components/ShooterPlayground';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Không tìm thấy phần tử root.');
// /                      the app (a prompt becomes a game)
// /?shooter=<level>      the playground for the hand-made levels (no API call)
const shooter = new URLSearchParams(window.location.search).get('shooter');
const page = shooter !== null ? <ShooterPlayground name={shooter}/> : <App/>;
createRoot(root).render(<StrictMode>{page}</StrictMode>);
