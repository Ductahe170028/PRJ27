import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ShooterApp } from './ShooterApp';
import { ShooterPlayground } from './components/ShooterPlayground';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Không tìm thấy phần tử root.');
// /                      the shooter app (a prompt becomes a game)
// /?shooter=<level>      the playground for the hand-made levels (no API call)
// /?legacy=standard      the previous Standard app (GameSpec v1), unchanged
const params = new URLSearchParams(window.location.search);
const shooter = params.get('shooter');
const page = shooter !== null ? <ShooterPlayground name={shooter}/> : params.get('legacy') === 'standard' ? <App/> : <ShooterApp/>;
createRoot(root).render(<StrictMode>{page}</StrictMode>);
