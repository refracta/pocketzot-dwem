import './style.css'
import { initApp } from './app'
import { calibrateSafeTop } from './viewport-inset'
import { maybeMountSafeAreaProbe } from './safe-area-probe'

const appEl = document.getElementById('app')
if (!appEl) throw new Error('#app element not found')

initApp(appEl)
calibrateSafeTop()
maybeMountSafeAreaProbe()
