import './style.css'
import { initApp } from './app'
import { installDwem } from './dwem'
import { initUiScale } from './ui-scale'
import { maybeMountSafeAreaProbe } from './safe-area-probe'
import { registerServiceWorker } from './sw/register'

const appEl = document.getElementById('app')
if (!appEl) throw new Error('#app element not found')

installDwem()
// Before the first view mounts, so nothing lays out at stock size first.
initUiScale()
initApp(appEl)
maybeMountSafeAreaProbe()
registerServiceWorker()
