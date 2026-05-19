import './style.css'
import { initApp } from './app'

const appEl = document.getElementById('app')
if (!appEl) throw new Error('#app element not found')

initApp(appEl)
