import './styles/base.css';
import './styles/pdf.css';
import './styles/md.css';
import { App } from './app';

const app = new App();
void app.start().catch((err) => {
  const content = document.getElementById('content');
  if (content) {
    content.textContent = `Error al iniciar Vela: ${(err as Error)?.message ?? err}`;
  }
});

// Punto de entrada para las pruebas E2E (sin acceso a datos internos).
(window as unknown as Record<string, unknown>).__velaApp = app;
