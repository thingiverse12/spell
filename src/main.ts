import './styles.css';
import { App } from './App';
import { installDebugApi } from './debug';
import { ModelLibrary } from './characters/models';
import { ROSTER } from './characters/roster';

const container = document.getElementById('scene-root');

if (!container) {
  throw new Error('#scene-root is missing from index.html');
}

const models = new ModelLibrary();

try {
  await models.loadAll(ROSTER);
} catch (error) {
  container.innerHTML = '';
  const message = document.createElement('pre');
  message.style.cssText = 'padding:24px;color:#ff9d4d;font:13px/1.6 ui-monospace,monospace';
  message.textContent = `Could not load character models.\n\n${String(error)}`;
  container.append(message);
  throw error;
}

const app = new App(container, models);
installDebugApi(app);
app.start();

// Vite HMR: tear the previous instance down so repeated updates do not leak
// WebGL contexts or listeners.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
