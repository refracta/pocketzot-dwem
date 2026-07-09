import './style.css'
import { initApp } from './app'
import { maybeMountSafeAreaProbe } from './safe-area-probe'

const appEl = document.getElementById('app')
if (!appEl) throw new Error('#app element not found')

initApp(appEl)
maybeMountSafeAreaProbe()
