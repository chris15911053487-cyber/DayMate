import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { queryClient } from './api/queries'
import { registerServiceWorker } from './push/device'
import './styles.css'

document.body.classList.add('app-surface')
// Service Worker 只管推送；注册失败（非 HTTPS 等）不影响使用
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
