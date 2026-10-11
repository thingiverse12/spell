import './styles.css';
import { App } from './App';
import { installDebugApi } from './debug';

const container = document.getElementById('scene-root');

if (!container) {
  throw new Error('#scene-root is missing from index.html');
}

const app = new App(container);
installDebugApi(app);
app.start();

// Vite HMR: tear the previous instance down so repeated updates do not leak
// WebGL contexts or listeners.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
