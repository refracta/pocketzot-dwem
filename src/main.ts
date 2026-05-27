import './style.css'
import { initApp } from './app'
import { installDwem } from './dwem'

const appEl = document.getElementById('app')
if (!appEl) throw new Error('#app element not found')

installDwem()
initApp(appEl)
